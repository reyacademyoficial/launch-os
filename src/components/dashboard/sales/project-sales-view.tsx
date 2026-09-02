"use client";

import { KgFilterSelectControlled as FilterSelect } from "@/components/kg/filter-select";

import {
  useMemo,
  useState,
  useTransition,
  type CSSProperties,
  type ReactNode,
} from "react";

import { KgDataTable, type Column } from "@/components/kg/data-table";
import { dangerBtn, smallBtn } from "@/components/kg/form-primitives";
import { KgPageFilters } from "@/components/kg/page-menu";
import { RangePills } from "@/components/kg/range-pills";
import { StateDot } from "@/components/kg/state-dot";
import { StatusPill } from "@/components/kg/status-pill";
import { TONE_VAR } from "@/components/kg/tone";
import type {
  FirstPaymentContext,
  PaymentActionState,
  SaleActionState,
} from "@/app/(app)/(kg)/proyectos/[projectId]/leads/sale-actions";
import { computeCommission, findApplicableRule } from "@/lib/commissions/calc";
import { buildSaleRanks } from "@/lib/commissions/ranking";
import type {
  CommissionRuleRow,
  InstallmentRow,
  PaymentModalityRow,
  PaymentRow,
  SaleRow,
} from "@/lib/commissions/types";
import { fmtMoney } from "@/lib/format";
import type { SaleExportRow } from "@/lib/launch-sales/export-types";
import {
  fmtNative,
  fmtUsd,
  normalizePaymentsForSaleCurrency,
  type Currency,
  type FxLookup,
} from "@/lib/money";
import type { LeadRow } from "@/lib/leads/types";
import type { PaymentMethodRow } from "@/lib/payment-methods/types";
import type { ProductRow } from "@/lib/products/types";
import type { TeamMemberRow } from "@/lib/team/types";

import { AddSaleModal } from "./add-sale-modal";
import { ExportSalesButton } from "./export-sales-button";
import { SaleModal } from "./sale-modal";

type CreateSaleAction = (
  leadId: string,
  prev: SaleActionState,
  formData: FormData,
) => Promise<SaleActionState>;
type CreateSaleWithLeadAction = (
  prev: SaleActionState,
  formData: FormData,
) => Promise<SaleActionState>;
type AddPaymentAction = (
  saleId: string,
  prev: PaymentActionState,
  formData: FormData,
) => Promise<PaymentActionState>;
type GetFirstPaymentContextAction = (
  saleId: string,
) => Promise<FirstPaymentContext>;
type DeletePaymentAction = (paymentId: string) => Promise<void>;
type DeleteSaleAction = (saleId: string) => Promise<void>;
type UpdateSaleProductAction = (
  saleId: string,
  productId: string,
  regenerate?: boolean,
) => Promise<{ ok: true } | { error: string }>;
type RecalculateSaleAction = (
  saleId: string,
) => Promise<{ ok: true } | { error: string }>;
type UpdateSaleAction = (
  saleId: string,
  prev: SaleActionState,
  formData: FormData,
) => Promise<SaleActionState>;
type UpdatePaymentInstallmentAction = (
  paymentId: string,
  installmentId: string | null,
) => Promise<{ ok: true } | { error: string }>;
type UpdatePaymentMethodAction = (
  paymentId: string,
  paymentMethodId: string | null,
) => Promise<{ ok: true } | { error: string }>;
type AssignLeadOwnerAction = (
  leadId: string,
  teamMemberId: string | null,
) => Promise<{ ok: true } | { error: string }>;

type LeadForSales = Pick<
  LeadRow,
  | "id"
  | "name"
  | "email"
  | "phone_normalized"
  | "contact"
  | "launch_id"
  | "team_member_id"
  | "status"
>;

type CollectionStatus = "all" | "paid" | "partial" | "unpaid";

interface FilterState {
  query: string;
  launchId: string;
  closerId: string;
  productId: string;
  paymentMethodId: string;
  collection: CollectionStatus;
}

const EMPTY_FILTERS: FilterState = {
  query: "",
  launchId: "all",
  closerId: "all",
  productId: "all",
  paymentMethodId: "all",
  collection: "all",
};

const UNASSIGNED_LAUNCH = "__unassigned__";
const UNASSIGNED_CLOSER = "__unassigned__";
const NO_METHOD = "__none__";

const COLLECTION_LABELS: Record<CollectionStatus, string> = {
  all: "Cualquier estado",
  paid: "Cobrada",
  partial: "Parcial",
  unpaid: "Sin cobrar",
};

/**
 * Cobrado por venta respetando moneda. Si todos los payments comparten la
 * moneda del sale → suma nativa. Si hay mismatch → USD (evita el bug de
 * sumar pesos + dólares como si fueran la misma unidad).
 */
interface CollectedDisplay {
  amount: number;
  currency: Currency;
  mixed: boolean;
}
function collectedForSale(
  saleCurrency: Currency,
  payments: ReadonlyArray<PaymentRow>,
  fxLookup: FxLookup | undefined,
): CollectedDisplay {
  if (payments.length === 0) {
    return { amount: 0, currency: saleCurrency, mixed: false };
  }
  if (!fxLookup) {
    let sum = 0;
    for (const p of payments) sum += Number(p.amount) || 0;
    return { amount: sum, currency: saleCurrency, mixed: false };
  }
  let native = 0;
  let allSame = true;
  for (const p of payments) {
    const c = fxLookup.byPaymentId[p.id]?.currency ?? saleCurrency;
    if (c !== saleCurrency) {
      allSame = false;
      break;
    }
    native += Number(p.amount) || 0;
  }
  if (allSame) {
    return { amount: native, currency: saleCurrency, mixed: false };
  }
  let usd = 0;
  for (const p of payments) {
    usd += fxLookup.byPaymentId[p.id]?.amountUsd ?? 0;
  }
  return { amount: usd, currency: "USD", mixed: true };
}

/**
 * Clasificador de estado de cobro FX-aware. Con moneda homogénea comparamos
 * en unidades nativas contra `total_amount`. Con mismatch, comparamos
 * cobrado(USD) contra `totalUsd`. Sin `totalUsd` (sale sin conversión),
 * degradamos al criterio crudo — imperfecto pero preserva el filtro.
 */
function classifySaleStatus(
  sale: SaleRow,
  payments: ReadonlyArray<PaymentRow>,
  fxLookup: FxLookup | undefined,
): "paid" | "partial" | "unpaid" {
  const saleCurrency: Currency =
    fxLookup?.bySaleId[sale.id]?.currency ?? "ARS";
  const collected = collectedForSale(saleCurrency, payments, fxLookup);
  const total = Number(sale.total_amount) || 0;
  if (collected.mixed) {
    const usdTotal = fxLookup?.bySaleId[sale.id]?.totalUsd ?? null;
    if (usdTotal !== null && usdTotal > 0) {
      if (collected.amount <= 0) return "unpaid";
      return collected.amount >= usdTotal ? "paid" : "partial";
    }
  }
  if (collected.amount <= 0) return "unpaid";
  return collected.amount >= total ? "paid" : "partial";
}

/**
 * Vista project-wide de ventas (Fase 12). Es intencionalmente más "plana" que
 * `CobrosView`: no muestra vencimientos ni cronograma acá — para eso está la
 * ficha (click en el nombre) y la vista de Cobros por launch. Acá el operador
 * mira producción total y edita/borra ventas.
 *
 * Método de pago por venta se agrega desde `payments`: hay ventas mixtas
 * (varios cobros con distintos métodos). Mostramos:
 *   - 0 métodos → "—" (venta sin cobrar)
 *   - 1 método → nombre
 *   - ≥2 métodos → "Mixto (N)" con tooltip listando los métodos
 */
export function ProjectSalesView({
  projectId,
  sales,
  payments,
  installments,
  invoices,
  leads,
  launches,
  modalities,
  products,
  rules,
  paymentMethods,
  methodCurrencies,
  teamMembers,
  canEdit,
  createSaleAction,
  createSaleWithLeadAction,
  addPaymentAction,
  getFirstPaymentContextAction,
  deletePaymentAction,
  deleteSaleAction,
  updateSaleProductAction,
  recalculateSaleAction,
  updateSaleAction,
  updatePaymentInstallmentAction,
  updatePaymentMethodAction,
  assignLeadOwnerAction,
  fxLookup,
  hideCommission = false,
}: {
  /** Necesario para el endpoint de export (`/api/proyectos/[id]/ventas/export`). */
  readonly projectId: string;
  readonly sales: ReadonlyArray<SaleRow>;
  readonly payments: ReadonlyArray<PaymentRow>;
  readonly installments: ReadonlyArray<InstallmentRow>;
  readonly invoices?: ReadonlyArray<{
    readonly id: string;
    readonly sale_id: string | null;
    readonly invoice_number: string | null;
    readonly installment_id: string | null;
    readonly amount_gross: number;
    readonly status: string;
  }>;
  readonly leads: ReadonlyArray<LeadForSales>;
  readonly launches: ReadonlyArray<{ id: string; name: string }>;
  readonly modalities: ReadonlyArray<PaymentModalityRow>;
  readonly products: ReadonlyArray<ProductRow>;
  readonly rules: ReadonlyArray<CommissionRuleRow>;
  readonly paymentMethods: ReadonlyArray<PaymentMethodRow>;
  /**
   * Lookup pre-computed paymentMethodId → moneda efectiva (banco o método).
   * Se pasa al AddSaleModal para el step 2 (primer cobro) — evita traer banks
   * al modal y mantener la misma fuente de verdad que CobrosView.
   */
  readonly methodCurrencies: Record<string, "ARS" | "USD">;
  readonly teamMembers: ReadonlyArray<
    Pick<TeamMemberRow, "id" | "name" | "active" | "role">
  >;
  readonly canEdit: boolean;
  /**
   * Lookup FX opcional. Cuando se pasa, cada fila muestra su moneda
   * nativa (AR$/US$) y el footer suma en USD. Sin fxLookup, fallback al
   * comportamiento antiguo (fmtMoney sin distinción de moneda).
   */
  readonly fxLookup?: FxLookup;
  readonly createSaleAction: CreateSaleAction;
  readonly createSaleWithLeadAction: CreateSaleWithLeadAction;
  readonly addPaymentAction: AddPaymentAction;
  readonly getFirstPaymentContextAction: GetFirstPaymentContextAction;
  readonly deletePaymentAction: DeletePaymentAction;
  readonly deleteSaleAction: DeleteSaleAction;
  readonly updateSaleProductAction: UpdateSaleProductAction;
  readonly recalculateSaleAction: RecalculateSaleAction;
  readonly updateSaleAction: UpdateSaleAction;
  readonly updatePaymentInstallmentAction: UpdatePaymentInstallmentAction;
  readonly updatePaymentMethodAction: UpdatePaymentMethodAction;
  readonly assignLeadOwnerAction: AssignLeadOwnerAction;
  /**
   * Oculta la columna "Comisión" (thead, tbody, tfoot) y también la propaga
   * a la ficha del alumno. Usado para el rol `closer`.
   */
  readonly hideCommission?: boolean;
}) {
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  /**
   * Remonta el <input> de búsqueda al limpiar los filtros. El input del drawer
   * es NO controlado (ver `SalesFilters`), así que la única forma de reflejar
   * un reset externo es cambiarle la `key` — nunca un `setState` en un efecto,
   * que el ESLint del repo prohíbe.
   */
  const [searchKey, setSearchKey] = useState(0);

  const leadById = useMemo(
    () => new Map(leads.map((l) => [l.id, l])),
    [leads],
  );
  const launchById = useMemo(
    () => new Map(launches.map((l) => [l.id, l])),
    [launches],
  );
  const productById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );
  const paymentMethodById = useMemo(
    () => new Map(paymentMethods.map((m) => [m.id, m])),
    [paymentMethods],
  );
  const teamById = useMemo(
    () => new Map(teamMembers.map((m) => [m.id, m])),
    [teamMembers],
  );

  const paymentsBySaleId = useMemo(() => {
    const out = new Map<string, PaymentRow[]>();
    for (const p of payments) {
      const arr = out.get(p.sale_id);
      if (arr) arr.push(p);
      else out.set(p.sale_id, [p]);
    }
    return out;
  }, [payments]);

  const installmentsBySaleId = useMemo(() => {
    const out = new Map<string, InstallmentRow[]>();
    for (const inst of installments) {
      const arr = out.get(inst.sale_id);
      if (arr) arr.push(inst);
      else out.set(inst.sale_id, [inst]);
    }
    return out;
  }, [installments]);

  const invoicesBySaleId = useMemo(() => {
    const out = new Map<
      string,
      Array<{
        readonly id: string;
        readonly invoice_number: string | null;
        readonly installment_id: string | null;
        readonly amount_gross: number;
        readonly status: string;
      }>
    >();
    for (const inv of invoices ?? []) {
      if (inv.sale_id == null) continue;
      const shaped = {
        id: inv.id,
        invoice_number: inv.invoice_number,
        installment_id: inv.installment_id,
        amount_gross: Number(inv.amount_gross),
        status: inv.status,
      };
      const arr = out.get(inv.sale_id);
      if (arr) arr.push(shaped);
      else out.set(inv.sale_id, [shaped]);
    }
    return out;
  }, [invoices]);

  const collectedBySale = useMemo(() => {
    const out = new Map<string, number>();
    for (const p of payments) {
      out.set(p.sale_id, (out.get(p.sale_id) ?? 0) + Number(p.amount));
    }
    return out;
  }, [payments]);

  /**
   * Métodos de pago distintos usados por los cobros de cada venta. Un método
   * puede aparecer varias veces (varias cuotas cobradas por Stripe) — nos
   * quedamos con el set de ids únicos. `null` (payment sin método) se guarda
   * como marcador para que el filtro "sin método" funcione.
   */
  const methodIdsBySale = useMemo(() => {
    const out = new Map<string, Set<string | null>>();
    for (const p of payments) {
      const set = out.get(p.sale_id) ?? new Set<string | null>();
      set.add(p.payment_method_id);
      out.set(p.sale_id, set);
    }
    return out;
  }, [payments]);

  // Ranking por (team_member, launch) para pasarlo a `computeCommission` — mismo
  // patrón que CobrosView. Se calcula sobre el universo completo de sales, no
  // sobre el filtrado, porque el rank de una venta no cambia al filtrar la UI.
  const rankBySaleId = useMemo(
    () => buildSaleRanks(sales as unknown as SaleRow[]),
    [sales],
  );

  const commissionBySale = useMemo(() => {
    const out = new Map<string, { amount: number; currency: "ARS" | "USD" }>();
    for (const s of sales) {
      const salePays = paymentsBySaleId.get(s.id) ?? [];
      const rule = findApplicableRule(
        rules,
        s.payment_modality_id,
        s.launch_id,
        s.product_id,
      );
      // Normalizar payments a la moneda del sale para no romper el ratio
      // collected/pledged. TODO(ui): mostrar warning si hasMixed.
      const { normalized } = normalizePaymentsForSaleCurrency(
        s,
        salePays,
        fxLookup,
      );
      const breakdown = computeCommission(
        s,
        normalized,
        rule,
        rankBySaleId.get(s.id) ?? 0,
      );
      out.set(s.id, {
        amount: breakdown.commission,
        currency: breakdown.commissionCurrency,
      });
    }
    return out;
  }, [sales, paymentsBySaleId, rules, rankBySaleId, fxLookup]);

  const normalizedQuery = filters.query.trim().toLowerCase();

  function saleMatches(sale: SaleRow): boolean {
    const lead = leadById.get(sale.lead_id);

    if (normalizedQuery) {
      const name = (lead?.name ?? "").toLowerCase();
      if (!name.includes(normalizedQuery)) return false;
    }

    if (filters.launchId !== "all") {
      if (filters.launchId === UNASSIGNED_LAUNCH) {
        if (sale.launch_id !== null) return false;
      } else if (sale.launch_id !== filters.launchId) {
        return false;
      }
    }

    if (filters.closerId !== "all") {
      // Atribución autoritativa: el dueño del lead. `sale.team_member_id`
      // es denorm y puede driftear — la ficha del alumno y el leaderboard
      // (post-0047) también leen del lead.
      const closerId = leadById.get(sale.lead_id)?.team_member_id ?? null;
      if (filters.closerId === UNASSIGNED_CLOSER) {
        if (closerId !== null) return false;
      } else if (closerId !== filters.closerId) {
        return false;
      }
    }

    if (filters.productId !== "all" && sale.product_id !== filters.productId) {
      return false;
    }

    if (filters.paymentMethodId !== "all") {
      const set = methodIdsBySale.get(sale.id);
      if (!set || set.size === 0) return false;
      if (filters.paymentMethodId === NO_METHOD) {
        // Match si la venta tiene AL MENOS un cobro sin método asignado.
        if (!set.has(null)) return false;
      } else if (!set.has(filters.paymentMethodId)) {
        return false;
      }
    }

    if (filters.collection !== "all") {
      const salePayments = paymentsBySaleId.get(sale.id) ?? [];
      const status = classifySaleStatus(sale, salePayments, fxLookup);
      if (status !== filters.collection) return false;
    }

    return true;
  }

  const filteredSales = useMemo(
    () => sales.filter(saleMatches),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sales, filters, leadById, methodIdsBySale, paymentsBySaleId, fxLookup],
  );

  const hasUnassignedLaunch = sales.some((s) => s.launch_id === null);
  // Mismo criterio autoritativo que la fila de tabla y el filtro.
  const hasUnassignedCloser = sales.some(
    (s) => (leadById.get(s.lead_id)?.team_member_id ?? null) === null,
  );
  const hasNoMethodPayment = payments.some((p) => p.payment_method_id === null);

  const filtersActive =
    filters.query !== "" ||
    filters.launchId !== "all" ||
    filters.closerId !== "all" ||
    filters.productId !== "all" ||
    filters.paymentMethodId !== "all" ||
    filters.collection !== "all";

  // Totales del subset visible.
  // Con fxLookup: totales en USD (convierte cada sale/pay). Sin fxLookup: suma
  // cruda que asume moneda única.
  let totalPactado = 0;
  let totalCobrado = 0;
  // Comisión: se acumula por moneda porque cada tier fixed tiene la suya
  // propia (migración 0107). El usuario pidió NO convertir — mostramos dos
  // totales cuando hay mezcla, uno único cuando todo comparte moneda.
  let totalComisionArs = 0;
  let totalComisionUsd = 0;
  const fmtRow = fxLookup
    ? (amount: number, saleId: string): string =>
        fmtNative(amount, fxLookup.bySaleId[saleId]?.currency ?? "USD")
    : (amount: number, _saleId: string): string => fmtMoney(amount);
  const fmtTotal = fxLookup ? fmtUsd : fmtMoney;
  for (const s of filteredSales) {
    if (fxLookup) {
      const usdSale = fxLookup.bySaleId[s.id]?.totalUsd ?? null;
      if (usdSale !== null) totalPactado += usdSale;
      // Cobrado en USD: sumamos cada payment convertido individualmente en
      // vez de escalar el total nativo por la tasa del sale — el escalado
      // rompe cuando los payments están en distinta moneda que el sale.
      for (const p of paymentsBySaleId.get(s.id) ?? []) {
        const usdPay = fxLookup.byPaymentId[p.id]?.amountUsd ?? null;
        if (usdPay !== null) totalCobrado += usdPay;
      }
    } else {
      totalPactado += Number(s.total_amount) || 0;
      totalCobrado += collectedBySale.get(s.id) ?? 0;
    }
    const c = commissionBySale.get(s.id);
    if (c) {
      if (c.currency === "USD") totalComisionUsd += c.amount;
      else totalComisionArs += c.amount;
    }
  }

  /**
   * Filas del xlsx. Se arma en el click del botón (no en un useMemo) porque
   * solo se necesita al exportar y recorre todo el subset filtrado.
   *
   * Refleja exactamente lo que muestra la tabla: mismo subset filtrado, misma
   * atribución de vendedor (dueño del lead), misma comisión y mismo cobrado
   * FX-aware. Suma columnas que la tabla no tiene lugar para mostrar
   * (pactado/cobrado en USD, cuotas, cierre) porque en Excel sí son útiles.
   */
  function buildExportRows(): SaleExportRow[] {
    return filteredSales.map((s) => {
      const lead = leadById.get(s.lead_id);
      const closerId = lead?.team_member_id ?? null;
      const salePayments = paymentsBySaleId.get(s.id) ?? [];
      const saleCurrency: Currency =
        fxLookup?.bySaleId[s.id]?.currency ?? "ARS";
      const collected = collectedForSale(saleCurrency, salePayments, fxLookup);
      const commission = commissionBySale.get(s.id) ?? {
        amount: 0,
        currency: "ARS" as const,
      };

      // Cobrado en USD: se convierte payment por payment (igual que el total
      // del tfoot). Si NINGÚN cobro tiene tasa, va null en vez de 0 para no
      // ensuciar el promedio del pivot.
      let collectedUsd: number | null = null;
      for (const p of salePayments) {
        const usd = fxLookup?.byPaymentId[p.id]?.amountUsd ?? null;
        if (usd !== null) collectedUsd = (collectedUsd ?? 0) + usd;
      }
      if (salePayments.length === 0) collectedUsd = 0;

      return {
        student: lead?.name ?? "—",
        email: lead?.email ?? "",
        phone: lead?.phone_normalized ?? "",
        contact: lead?.contact ?? "",
        product: productById.get(s.product_id)?.name ?? "—",
        launch: (s.launch_id ? launchById.get(s.launch_id)?.name : null) ?? "—",
        seller: closerId ? (teamById.get(closerId)?.name ?? "—") : "Sin asignar",
        method: methodLabelPlain(methodIdsBySale.get(s.id), paymentMethodById),
        currency: saleCurrency,
        pledged: Number(s.total_amount) || 0,
        collected: collected.amount,
        collectedCurrency: collected.currency,
        mixedCurrency: collected.mixed,
        commission: commission.amount,
        commissionCurrency: commission.currency,
        status: classifySaleStatus(s, salePayments, fxLookup),
        pledgedUsd: fxLookup ? (fxLookup.bySaleId[s.id]?.totalUsd ?? null) : null,
        collectedUsd,
        paymentCount: salePayments.length,
        installmentCount: s.installment_count,
        closedAt: s.closed_at,
      };
    });
  }

  /** Filtros activos en texto, para la hoja "Resumen" del xlsx. */
  function buildFilterSummary(): string[] {
    const out: string[] = [];
    if (filters.query.trim()) out.push(`Búsqueda: "${filters.query.trim()}"`);
    if (filters.launchId !== "all") {
      out.push(
        `Lanzamiento: ${
          filters.launchId === UNASSIGNED_LAUNCH
            ? "Sin launch"
            : (launchById.get(filters.launchId)?.name ?? filters.launchId)
        }`,
      );
    }
    if (filters.closerId !== "all") {
      out.push(
        `Vendedor: ${
          filters.closerId === UNASSIGNED_CLOSER
            ? "Sin asignar"
            : (teamById.get(filters.closerId)?.name ?? filters.closerId)
        }`,
      );
    }
    if (filters.productId !== "all") {
      out.push(
        `Producto: ${productById.get(filters.productId)?.name ?? filters.productId}`,
      );
    }
    if (filters.paymentMethodId !== "all") {
      out.push(
        `Método: ${
          filters.paymentMethodId === NO_METHOD
            ? "Sin método asignado"
            : (paymentMethodById.get(filters.paymentMethodId)?.name ??
              filters.paymentMethodId)
        }`,
      );
    }
    if (filters.collection !== "all") {
      out.push(`Estado de cobro: ${COLLECTION_LABELS[filters.collection]}`);
    }
    return out;
  }

  /** Filtros con valor distinto al default — alimenta el badge de "Filtros". */
  const activeFilterCount =
    (filters.query !== "" ? 1 : 0) +
    (filters.launchId !== "all" ? 1 : 0) +
    (filters.closerId !== "all" ? 1 : 0) +
    (filters.productId !== "all" ? 1 : 0) +
    (filters.paymentMethodId !== "all" ? 1 : 0) +
    (filters.collection !== "all" ? 1 : 0);

  /** Datos del lead que consume `SaleModal`. Sin cambios respecto de antes. */
  function leadForModalOf(
    s: SaleRow,
  ): Pick<LeadRow, "id" | "name" | "launch_id" | "team_member_id"> {
    const lead = leadById.get(s.lead_id);
    return lead
      ? {
          id: lead.id,
          name: lead.name,
          launch_id: lead.launch_id,
          team_member_id: lead.team_member_id,
        }
      : {
          id: s.lead_id,
          name: "—",
          launch_id: null,
          team_member_id: s.team_member_id,
        };
  }

  /** Props del SaleModal comunes a los dos triggers de la fila (nombre y "Editar"). */
  function saleModalProps(s: SaleRow) {
    const leadForModal = leadForModalOf(s);
    return {
      lead: leadForModal,
      sales: [s],
      saleRanks: rankBySaleId,
      paymentsBySaleId: new Map([[s.id, paymentsBySaleId.get(s.id) ?? []]]),
      installmentsBySaleId: new Map([
        [s.id, installmentsBySaleId.get(s.id) ?? []],
      ]),
      invoicesBySaleId: new Map([[s.id, invoicesBySaleId.get(s.id) ?? []]]),
      initialSaleId: s.id,
      allowCreateAnother: false,
      modalities,
      products,
      rules,
      paymentMethods,
      teamMembers,
      createSaleAction: createSaleAction.bind(null, leadForModal.id),
      updateProductAction: (saleId: string, productId: string) =>
        updateSaleProductAction(saleId, productId),
      recalculateAction: recalculateSaleAction,
      updateSaleAction,
      addPaymentAction,
      deletePaymentAction,
      deleteSaleAction,
      updatePaymentInstallmentAction,
      updatePaymentMethodAction,
      assignLeadOwnerAction: canEdit ? assignLeadOwnerAction : undefined,
      fxLookup,
      hideCommission,
    };
  }

  const comisionColumn: Column<SaleRow> = {
    key: "comision",
    label: "Comisión",
    align: "right",
    numeric: true,
    // Antes iba en carmesí (`text-accent`). La plata no se pinta: el número
    // queda en el color de la tabla como el resto de los importes.
    render: (s) => {
      const commission = commissionBySale.get(s.id) ?? {
        amount: 0,
        currency: "ARS" as const,
      };
      return fmtNative(commission.amount, commission.currency);
    },
  };

  const accionesColumn: Column<SaleRow> = {
    key: "acciones",
    label: "Acciones",
    align: "right",
    render: (s) => {
      const lead = leadById.get(s.lead_id);
      const salePayments = paymentsBySaleId.get(s.id) ?? [];
      return (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 8,
          }}
        >
          {/* `triggerStyle` (agregado por la migración de SaleModal) deja
              usar la primitiva `smallBtn` en vez de clases de tokens viejos. */}
          <SaleModal
            {...saleModalProps(s)}
            triggerLabel="Editar"
            triggerStyle={smallBtn}
          />
          <DeleteSaleButton
            saleId={s.id}
            leadName={lead?.name ?? "alumno"}
            paymentCount={salePayments.length}
            totalAmountLabel={fmtRow(Number(s.total_amount) || 0, s.id)}
            deleteSaleAction={deleteSaleAction}
          />
        </span>
      );
    },
  };

  const columns: ReadonlyArray<Column<SaleRow>> = [
    {
      key: "alumno",
      label: "Alumno",
      render: (s) => {
        const lead = leadById.get(s.lead_id);
        return (
          <SaleModal
            {...saleModalProps(s)}
            triggerLabel={lead?.name ?? "—"}
            triggerStyle={nameTriggerStyle}
            // El subrayado en hover es lo único que no se puede expresar con
            // estilos inline; el resto del look va en `triggerStyle`.
            triggerClassName="underline-offset-2 hover:underline"
          />
        );
      },
    },
    {
      key: "producto",
      label: "Producto",
      render: (s) => productById.get(s.product_id)?.name ?? <Dash />,
    },
    {
      key: "pactado",
      label: "Monto pactado",
      align: "right",
      numeric: true,
      render: (s) => fmtRow(Number(s.total_amount), s.id),
    },
    {
      key: "cobrado",
      label: "Monto cobrado",
      align: "right",
      numeric: true,
      render: (s) => {
        const salePayments = paymentsBySaleId.get(s.id) ?? [];
        const saleCurrency: Currency =
          fxLookup?.bySaleId[s.id]?.currency ?? "ARS";
        const display = collectedForSale(saleCurrency, salePayments, fxLookup);
        return (
          <span style={numericCellStyle}>
            {fxLookup
              ? fmtNative(display.amount, display.currency)
              : fmtMoney(display.amount)}
            {display.mixed && (
              // El monto no se pinta: el aviso de moneda mezclada es un dot.
              <span
                title="Los cobros de esta venta están en moneda distinta al pactado. Total mostrado convertido a USD."
                aria-label="Cobros en moneda distinta al pactado"
                style={{ display: "inline-flex" }}
              >
                <StateDot tone="warning" />
              </span>
            )}
          </span>
        );
      },
    },
    ...(hideCommission ? [] : [comisionColumn]),
    {
      key: "metodo",
      label: "Método",
      render: (s) => {
        const display = renderMethodCell(
          methodIdsBySale.get(s.id),
          paymentMethodById,
        );
        return <span title={display.title}>{display.text}</span>;
      },
    },
    {
      key: "vendedor",
      label: "Vendedor",
      render: (s) => {
        // Atribución del dueño del lead (autoritativa). Ver las notas del
        // filtro `closerId` sobre por qué no leemos `sale.team_member_id`.
        const closerId = leadById.get(s.lead_id)?.team_member_id ?? null;
        const closer = closerId ? teamById.get(closerId) : null;
        return closer ? (
          closer.name
        ) : (
          <StatusPill text="Sin asignar" tone={TONE_VAR.warning} />
        );
      },
    },
    {
      key: "lanzamiento",
      label: "Lanzamiento",
      render: (s) =>
        (s.launch_id ? launchById.get(s.launch_id)?.name : null) ?? <Dash />,
    },
    ...(canEdit ? [accionesColumn] : []),
  ];

  return (
    // `paddingTop` en vez de margen: la vista se monta dentro del Panel de la
    // page (pad={false}) justo debajo de su nota introductoria.
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        paddingTop: 12,
      }}
    >
      {/*
        Los filtros ya no viven arriba de la tabla: `KgPageFilters` los registra
        en el drawer (desktop) / bottom-sheet (mobile) del botón "Filtros" del
        ContextBar y devuelve null. Motivo: alto vertical — la franja de 1 input
        + 5 selects se comía la primera pantalla y esta tabla es la vista.
      */}
      <KgPageFilters activeCount={activeFilterCount}>
        <SalesFilters
          filters={filters}
          onChange={setFilters}
          searchKey={searchKey}
          onClear={() => {
            setFilters(EMPTY_FILTERS);
            setSearchKey((k) => k + 1);
          }}
          launches={launches}
          closers={teamMembers}
          products={products}
          paymentMethods={paymentMethods}
          hasUnassignedLaunch={hasUnassignedLaunch}
          hasUnassignedCloser={hasUnassignedCloser}
          hasNoMethodPayment={hasNoMethodPayment}
          totalSalesCount={sales.length}
          filteredSalesCount={filteredSales.length}
          filtersActive={filtersActive}
        />
      </KgPageFilters>

      {/*
        Export + alta. Van acá y no en `actions` del Panel porque el Panel lo
        pone la PAGE (`ventas/page.tsx` envuelve esta vista en
        `<Panel title="Todas las ventas" pad={false}>`): meter otro Panel sería
        una tarjeta glass dentro de otra. El padding lateral (20px) iguala el
        de la nota introductoria de la page para que todo alinee.
      */}
      {canEdit && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 8,
            padding: "0 20px",
          }}
        >
          <ExportSalesButton
            projectId={projectId}
            getRows={buildExportRows}
            getFilterSummary={buildFilterSummary}
            hideCommission={hideCommission}
            disabled={filteredSales.length === 0}
          />
          <AddSaleModal
            launches={launches}
            modalities={modalities}
            products={products}
            teamMembers={teamMembers}
            paymentMethods={paymentMethods}
            methodCurrencies={methodCurrencies}
            createSaleWithLeadAction={createSaleWithLeadAction}
            addPaymentAction={addPaymentAction}
            getFirstPaymentContextAction={getFirstPaymentContextAction}
          />
        </div>
      )}

      <KgDataTable
        columns={columns}
        rows={filteredSales}
        rowKey={(s) => s.id}
        // Techo de alto en vez de `fillHeight`: la page todavía no propaga
        // altura (no hay `Panel fillHeight` ni la cadena `h-full min-h-0`).
        // Con esto el <thead> y la fila de totales quedan sticky y el body
        // scrollea dentro del Panel en vez de estirar la página.
        maxBodyHeight="min(62vh, 720px)"
        emptyTitle={
          sales.length === 0
            ? "Sin ventas registradas en el proyecto todavía."
            : "Ninguna venta coincide con los filtros aplicados."
        }
        emptyHint={
          sales.length === 0
            ? canEdit
              ? "Cargá la primera con + Nueva venta."
              : undefined
            : "Ajustá o limpiá los filtros desde el botón Filtros."
        }
        totalsRow={{
          label: filtersActive
            ? `Subtotal filtrado · ${filteredSales.length} venta${filteredSales.length === 1 ? "" : "s"}`
            : `Total · ${filteredSales.length} venta${filteredSales.length === 1 ? "" : "s"}`,
          // Cubre Alumno + Producto; los importes arrancan en "Monto pactado".
          labelSpan: 2,
          cells: {
            pactado: fmtTotal(totalPactado),
            cobrado: fmtTotal(totalCobrado),
            // La comisión NO se convierte entre monedas (decisión de negocio,
            // migración 0107): con mezcla se muestran los dos totales.
            comision:
              totalComisionArs > 0 && totalComisionUsd > 0 ? (
                <span
                  style={{
                    display: "inline-flex",
                    flexDirection: "column",
                    alignItems: "flex-end",
                    lineHeight: 1.25,
                  }}
                >
                  <span>{fmtNative(totalComisionArs, "ARS")}</span>
                  <span>{fmtNative(totalComisionUsd, "USD")}</span>
                </span>
              ) : totalComisionUsd > 0 ? (
                fmtNative(totalComisionUsd, "USD")
              ) : (
                fmtNative(totalComisionArs, "ARS")
              ),
          },
        }}
      />
    </div>
  );
}

/**
 * Trigger del nombre del alumno: se lee como texto de la celda, no como
 * botón. El subrayado sólo aparece en hover (vía clase, ver call site).
 */
const nameTriggerStyle: CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  // La tipografía la hereda del <td> (el reset del repo pone `font: inherit`
  // en los botones); acá sólo se refuerza el peso del nombre.
  fontWeight: 600,
  color: "var(--kg-text-1)",
  textAlign: "left",
  cursor: "pointer",
};

/** Celda numérica con un dot de estado al lado del número (nunca encima). */
const numericCellStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: 6,
};

/** Placeholder gris para celdas sin valor. */
function Dash() {
  return <span style={{ color: "var(--kg-text-3)" }}>—</span>;
}

/**
 * Devuelve el label para la celda "Método" + un title (tooltip) con el detalle
 * cuando la venta tiene varios métodos. Si hay al menos un cobro sin método
 * asignado, lo marcamos aparte porque es un warning de backfill pendiente.
 */
function renderMethodCell(
  methodSet: ReadonlySet<string | null> | undefined,
  paymentMethodById: ReadonlyMap<string, PaymentMethodRow>,
): { text: ReactNode; title?: string } {
  if (!methodSet || methodSet.size === 0) {
    return { text: <Dash /> };
  }
  const withMethod = Array.from(methodSet).filter(
    (id): id is string => id !== null,
  );
  const hasNull = methodSet.has(null);
  const names = withMethod
    .map((id) => paymentMethodById.get(id)?.name ?? "—")
    .sort((a, b) => a.localeCompare(b));

  if (names.length === 0) {
    // Solo cobros sin método. El ámbar ya no pinta el texto: vive en el dot.
    return {
      text: <StatusPill text="Sin método" tone={TONE_VAR.warning} />,
    };
  }
  if (names.length === 1) {
    const label = names[0]!;
    if (hasNull) {
      return {
        text: (
          <StatusPill text={`${label} + sin método`} tone={TONE_VAR.warning} />
        ),
        title: `${label}; algún cobro sin método asignado`,
      };
    }
    return { text: label };
  }
  const detail = hasNull
    ? `${names.join(", ")}; algún cobro sin método asignado`
    : names.join(", ");
  return {
    text: `Mixto (${hasNull ? names.length + 1 : names.length})`,
    title: detail,
  };
}

/**
 * Versión texto plano de `renderMethodCell` para el xlsx. No colapsamos a
 * "Mixto (N)" como en la tabla: en Excel hay ancho de sobra y el detalle es
 * justo lo que se quiere filtrar/pivotear.
 */
function methodLabelPlain(
  methodSet: ReadonlySet<string | null> | undefined,
  paymentMethodById: ReadonlyMap<string, PaymentMethodRow>,
): string {
  if (!methodSet || methodSet.size === 0) return "—";
  const names = Array.from(methodSet)
    .filter((id): id is string => id !== null)
    .map((id) => paymentMethodById.get(id)?.name ?? "—")
    .sort((a, b) => a.localeCompare(b));
  if (methodSet.has(null)) names.push("Sin método");
  return names.join(", ");
}

// ─── Filtros (viven en el drawer de página) ───────────────────────────────

/**
 * Pills del estado de cobro. `RangePills` usa el propio string como label y
 * como value; el mapa traduce pill ↔ `CollectionStatus` para no tocar el
 * contrato del filtro (`saleMatches` sigue leyendo `all|paid|partial|unpaid`).
 */
const COLLECTION_PILLS = ["Todas", "Cobrada", "Parcial", "Sin cobrar"] as const;
type CollectionPill = (typeof COLLECTION_PILLS)[number];
const PILL_TO_COLLECTION: Record<CollectionPill, CollectionStatus> = {
  Todas: "all",
  Cobrada: "paid",
  Parcial: "partial",
  "Sin cobrar": "unpaid",
};
const COLLECTION_TO_PILL: Record<CollectionStatus, CollectionPill> = {
  all: "Todas",
  paid: "Cobrada",
  partial: "Parcial",
  unpaid: "Sin cobrar",
};

/**
 * Bloque de filtros del drawer.
 *
 * POR QUÉ NO USA `KgFilterSelect`
 * Esa primitiva es URL-first: cada opción lleva un `href` y elegir dispara
 * `router.push`. Los filtros de esta vista NO viven en la URL — la page trae
 * TODAS las ventas del proyecto y el filtrado (más el subset que exporta el
 * xlsx) es en memoria, instantáneo. Moverlos a la URL convertiría cada cambio
 * en una navegación con re-render del server component (refetch completo) y en
 * una entrada de historial. Por eso se replica el look de `KgFilterSelect` con
 * `value`/`onChange` local. Ver reporte de migración.
 */
function SalesFilters({
  filters,
  onChange,
  searchKey,
  onClear,
  launches,
  closers,
  products,
  paymentMethods,
  hasUnassignedLaunch,
  hasUnassignedCloser,
  hasNoMethodPayment,
  totalSalesCount,
  filteredSalesCount,
  filtersActive,
}: {
  readonly filters: FilterState;
  readonly onChange: (next: FilterState) => void;
  readonly searchKey: number;
  readonly onClear: () => void;
  readonly launches: ReadonlyArray<{ id: string; name: string }>;
  readonly closers: ReadonlyArray<
    Pick<TeamMemberRow, "id" | "name" | "active">
  >;
  readonly products: ReadonlyArray<ProductRow>;
  readonly paymentMethods: ReadonlyArray<PaymentMethodRow>;
  readonly hasUnassignedLaunch: boolean;
  readonly hasUnassignedCloser: boolean;
  readonly hasNoMethodPayment: boolean;
  readonly totalSalesCount: number;
  readonly filteredSalesCount: number;
  readonly filtersActive: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}
      >
        <label
          htmlFor="ventas-buscar"
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", fontWeight: 600 }}
        >
          Buscar
        </label>
        {/*
          Input NO controlado a propósito: el nodo de filtros se registra en el
          sheet vía efecto, así que si el value viviera en el estado del padre
          cada tecla re-registraría el grupo y el <input> quedaría un commit
          detrás del DOM (lo aprendimos migrando leads). La `key` lo remonta
          cuando "Limpiar" resetea los filtros desde afuera.
        */}
        <input
          key={`ventas-buscar-${searchKey}`}
          id="ventas-buscar"
          type="search"
          className="kg-focus"
          placeholder="Nombre del alumno…"
          defaultValue={filters.query}
          onChange={(e) => onChange({ ...filters, query: e.target.value })}
          aria-label="Buscar alumno"
          style={filterFieldStyle}
        />
      </div>

      <FilterSelect
        id="ventas-launch"
        label="Lanzamiento"
        value={filters.launchId}
        onChange={(v) => onChange({ ...filters, launchId: v })}
        options={[
          { value: "all", label: "Todos los lanzamientos" },
          ...(hasUnassignedLaunch
            ? [{ value: UNASSIGNED_LAUNCH, label: "Sin launch" }]
            : []),
          ...launches.map((l) => ({ value: l.id, label: l.name })),
        ]}
      />

      <FilterSelect
        id="ventas-vendedor"
        label="Vendedor"
        value={filters.closerId}
        onChange={(v) => onChange({ ...filters, closerId: v })}
        options={[
          { value: "all", label: "Todos los vendedores" },
          ...(hasUnassignedCloser
            ? [{ value: UNASSIGNED_CLOSER, label: "Sin asignar" }]
            : []),
          ...closers.map((c) => ({
            value: c.id,
            label: `${c.name}${c.active ? "" : " (inactivo)"}`,
          })),
        ]}
      />

      <FilterSelect
        id="ventas-producto"
        label="Producto"
        value={filters.productId}
        onChange={(v) => onChange({ ...filters, productId: v })}
        options={[
          { value: "all", label: "Todos los productos" },
          ...products.map((p) => ({
            value: p.id,
            label: `${p.name}${p.active ? "" : " (inactivo)"}`,
          })),
        ]}
      />

      <FilterSelect
        id="ventas-metodo"
        label="Método de pago"
        value={filters.paymentMethodId}
        onChange={(v) => onChange({ ...filters, paymentMethodId: v })}
        options={[
          { value: "all", label: "Todos los métodos" },
          ...(hasNoMethodPayment
            ? [{ value: NO_METHOD, label: "Sin método asignado" }]
            : []),
          ...paymentMethods.map((m) => ({
            value: m.id,
            label: `${m.name}${m.active ? "" : " (inactivo)"}`,
          })),
        ]}
      />

      <div
        style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}
      >
        <span
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", fontWeight: 600 }}
        >
          Estado de cobro
        </span>
        {/* Cuatro opciones cortas y excluyentes → pills, no select. El wrapper
            scrollea en 390px para que no desborde el bottom-sheet. */}
        <div style={{ overflowX: "auto", maxWidth: "100%" }}>
          <RangePills
            options={COLLECTION_PILLS}
            value={COLLECTION_TO_PILL[filters.collection]}
            onChange={(next) =>
              onChange({ ...filters, collection: PILL_TO_COLLECTION[next] })
            }
          />
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          paddingTop: 4,
          borderTop: "1px solid var(--kg-border-subtle)",
        }}
      >
        <span className="kg-t7 kg-num" style={{ color: "var(--kg-text-3)" }}>
          {filtersActive
            ? `${filteredSalesCount} de ${totalSalesCount} ventas`
            : `${totalSalesCount} ventas`}
        </span>
        {filtersActive && (
          <button
            type="button"
            onClick={onClear}
            className="kg-focus"
            style={{
              background: "none",
              border: "none",
              padding: 2,
              fontSize: 11,
              fontWeight: 700,
              color: "var(--kg-accent-text)",
              cursor: "pointer",
            }}
          >
            Limpiar
          </button>
        )}
      </div>
    </div>
  );
}

/** Campo del drawer. Mismo look que el <select> de `KgFilterSelect`. */
const filterFieldStyle: CSSProperties = {
  width: "100%",
  minWidth: 0,
  padding: "8px 12px",
  borderRadius: "var(--kg-r-8)",
  background: "var(--kg-surface-2-solid)",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-1)",
  fontSize: 12,
  fontWeight: 600,
  colorScheme: "dark",
};

/**
 * Clon local de `KgFilterSelect` con `value`/`onChange` en vez de `href`. Ver
 * la nota de `SalesFilters` sobre por qué esta vista no usa la primitiva.
 */

function DeleteSaleButton({
  saleId,
  leadName,
  paymentCount,
  totalAmountLabel,
  deleteSaleAction,
}: {
  readonly saleId: string;
  readonly leadName: string;
  readonly paymentCount: number;
  /** Monto ya formateado con su moneda nativa (AR$/US$). */
  readonly totalAmountLabel: string;
  readonly deleteSaleAction: DeleteSaleAction;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        const msg =
          paymentCount > 0
            ? `¿Borrar la venta de ${leadName} (${totalAmountLabel}) y sus ${paymentCount} cobro${paymentCount === 1 ? "" : "s"}?`
            : `¿Borrar la venta de ${leadName} (${totalAmountLabel})?`;
        if (!confirm(msg)) return;
        startTransition(async () => {
          await deleteSaleAction(saleId);
        });
      }}
      aria-label={`Borrar venta de ${leadName}`}
      className="kg-focus"
      style={{
        ...dangerBtn,
        padding: "3px 10px",
        opacity: pending ? 0.5 : 1,
        cursor: pending ? "wait" : "pointer",
      }}
    >
      {pending ? "…" : "Borrar"}
    </button>
  );
}
