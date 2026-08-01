/**
 * Contexto de conversión FX para sales / payments. Se arma UNA vez en la
 * page server-side con toda la data joineable (banks, payment_methods,
 * leads, launches, project_fx_rates) y se pasa a los componentes cliente
 * como objeto serializable — no acopla el componente al schema.
 *
 * Convención de moneda (coherente con el backfill `src/lib/backfill/fx.ts`):
 *   - Payment: moneda del banco del método (o del método si no tiene banco).
 *   - Sale: ARS si su launch tiene `ars_per_usd` cargado, USD si no.
 *
 * Convención de tasa:
 *   - Payment: launch del sale del payment → fallback a tasa mensual del
 *     mes de `paid_at`.
 *   - Sale: solo tasa del launch (sin fallback mensual — el sale sí tiene
 *     relación directa con el launch).
 */

import type { Currency, FxContext } from "./types";
import { effectiveCurrency, resolveMonthlyRateFromMap } from "./rates";
import { toUsd } from "./convert";

export interface SalesFxContext {
  paymentCurrency(payment: PaymentLike): Currency;
  saleCurrency(sale: SaleLike): Currency;
  paymentToUsd(payment: PaymentLike): number | null;
  saleToUsd(sale: SaleLike): number | null;
  /** Formato helper: `<AR$1.234>` o `<US$100>` según moneda del payment. */
  fmtPaymentNative(payment: PaymentLike): string;
  fmtSaleNative(sale: SaleLike): string;
}

interface PaymentLike {
  readonly amount: number;
  readonly paid_at: string;
  readonly sale_id: string;
  readonly payment_method_id: string | null;
  readonly original_currency?: "ARS" | "USD" | null;
}

interface SaleLike {
  readonly id: string;
  readonly lead_id: string;
  readonly total_amount: number;
}

interface BankLike {
  readonly id: string;
  readonly currency: Currency;
}

interface PaymentMethodLike {
  readonly id: string;
  readonly bank_id: string | null;
  readonly currency?: Currency | null;
}

interface LeadLike {
  readonly id: string;
  readonly launch_id: string | null;
}

interface LaunchLike {
  readonly id: string;
  readonly ars_per_usd?: number | null;
}

export interface BuildSalesFxContextArgs {
  readonly banks: readonly BankLike[];
  readonly paymentMethods: readonly PaymentMethodLike[];
  readonly leads: readonly LeadLike[];
  readonly launches: readonly LaunchLike[];
  readonly sales: readonly SaleLike[];
  readonly fxMap: Map<string, number>;
}

/**
 * Arma el contexto server-side. Los mapas internos son referencias a los
 * arrays de entrada — no clona nada. Diseñado para llamarse una vez y
 * reusarse en múltiples renders sin costo extra.
 */
export function buildSalesFxContext(
  args: BuildSalesFxContextArgs,
): SalesFxContext {
  const banksById = new Map(args.banks.map((b) => [b.id, b]));
  const methodsById = new Map(args.paymentMethods.map((m) => [m.id, m]));
  const leadsById = new Map(args.leads.map((l) => [l.id, l]));
  const launchesById = new Map(args.launches.map((l) => [l.id, l]));
  const salesById = new Map(args.sales.map((s) => [s.id, s]));

  function launchOfSale(saleId: string): LaunchLike | null {
    const sale = salesById.get(saleId);
    if (!sale) return null;
    const lead = leadsById.get(sale.lead_id);
    if (!lead?.launch_id) return null;
    return launchesById.get(lead.launch_id) ?? null;
  }

  function launchRateOfSale(saleId: string): number | null {
    const l = launchOfSale(saleId);
    const v = l?.ars_per_usd ?? null;
    return v != null && Number.isFinite(v) && v > 0 ? v : null;
  }

  function paymentCurrency(payment: PaymentLike): Currency {
    if (payment.original_currency === "ARS" || payment.original_currency === "USD") {
      return payment.original_currency;
    }
    const method = payment.payment_method_id
      ? methodsById.get(payment.payment_method_id) ?? null
      : null;
    const bank = method?.bank_id ? banksById.get(method.bank_id) ?? null : null;
    return effectiveCurrency(method, bank);
  }

  function saleCurrency(sale: SaleLike): Currency {
    return launchRateOfSale(sale.id) ? "ARS" : "USD";
  }

  function paymentToUsd(payment: PaymentLike): number | null {
    const currency = paymentCurrency(payment);
    const launchRate = launchRateOfSale(payment.sale_id);
    const monthlyRate = resolveMonthlyRateFromMap(args.fxMap, payment.paid_at);
    const ctx: FxContext = {
      launchArsPerUsd: launchRate,
      monthlyArsPerUsd: monthlyRate,
    };
    return toUsd({ amount: Number(payment.amount) || 0, currency }, ctx);
  }

  function saleToUsd(sale: SaleLike): number | null {
    const currency = saleCurrency(sale);
    const launchRate = launchRateOfSale(sale.id);
    return toUsd(
      { amount: Number(sale.total_amount) || 0, currency },
      { launchArsPerUsd: launchRate },
    );
  }

  return {
    paymentCurrency,
    saleCurrency,
    paymentToUsd,
    saleToUsd,
    fmtPaymentNative: (p) => nativeSuffix(Number(p.amount) || 0, paymentCurrency(p)),
    fmtSaleNative: (s) => nativeSuffix(Number(s.total_amount) || 0, saleCurrency(s)),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// FxLookup — versión serializable de SalesFxContext, apta para pasar de
// Server Components a Client Components como prop (sin funciones).
// ═══════════════════════════════════════════════════════════════════════════

export interface SaleFxEntry {
  currency: Currency;
  /** total_amount convertido a USD; null si falta la tasa. */
  totalUsd: number | null;
}

export interface PaymentFxEntry {
  currency: Currency;
  /** amount convertido a USD; null si falta la tasa. */
  amountUsd: number | null;
}

/** Objeto puro (sin métodos) que los Client Components usan para formatear. */
export interface FxLookup {
  bySaleId: Record<string, SaleFxEntry>;
  byPaymentId: Record<string, PaymentFxEntry>;
}

type SaleForLookup = { id: string; lead_id: string; total_amount: number };
type PaymentForLookup = {
  id: string;
  amount: number;
  paid_at: string;
  sale_id: string;
  payment_method_id: string | null;
  original_currency?: "ARS" | "USD" | null;
};

/**
 * Convierte un SalesFxContext en un FxLookup serializable. Se llama una vez
 * en el Server Component y el resultado se pasa como prop al Client Component.
 */
export function buildFxLookup(
  fxCtx: SalesFxContext,
  sales: ReadonlyArray<SaleForLookup>,
  payments: ReadonlyArray<PaymentForLookup>,
): FxLookup {
  const bySaleId: Record<string, SaleFxEntry> = {};
  for (const s of sales) {
    bySaleId[s.id] = {
      currency: fxCtx.saleCurrency(s),
      totalUsd: fxCtx.saleToUsd(s),
    };
  }
  const byPaymentId: Record<string, PaymentFxEntry> = {};
  for (const p of payments) {
    byPaymentId[p.id] = {
      currency: fxCtx.paymentCurrency(p),
      amountUsd: fxCtx.paymentToUsd(p),
    };
  }
  return { bySaleId, byPaymentId };
}

// Inlined format para evitar dependencia circular con `./format` — mismo
// resultado que `fmtNative` pero copiado acá porque este archivo lo usan
// componentes que ya importan `fmtUsd` etc.
const nfInt = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
function nativeSuffix(n: number, currency: Currency): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const prefix = currency === "USD" ? "US$" : "AR$";
  return `${sign}${prefix} ${nfInt.format(Math.abs(Math.round(n)))}`;
}
