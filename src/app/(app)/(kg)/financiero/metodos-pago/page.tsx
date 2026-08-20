import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { IconFin } from "@/components/kg/icons";
import { KgParamPills } from "@/components/kg/param-pills";
import { Panel } from "@/components/kg/panel";
import { listBanks } from "@/lib/banks/list";
import { fCount } from "@/lib/finance/format";
import { effectiveCurrency, fmtArs, fmtUsd } from "@/lib/money";
import { listPaymentMethods } from "@/lib/payment-methods/list";
import { createClient } from "@/lib/supabase/server";

import {
  MetodosPagoView,
  type PaymentMethodRowData,
} from "./metodos-pago-view";
import { NewPaymentMethodButton } from "./new-method-button";
import type { BankOption } from "./payment-method-form-drawer";

export const metadata: Metadata = { title: "Métodos de pago · Financiero" };

// Métodos de pago son estructurales, no eventos — sin filtro de período.
// Filtro por estado (activos/inactivos/todos). Post 0134 el catálogo es
// org-scope: no hay filtro por proyecto (bajan a todos igual).
type ActiveParam = "activos" | "inactivos" | "todos";

const ACTIVE_OPTIONS: ReadonlyArray<{ value: ActiveParam; label: string }> = [
  { value: "activos", label: "Activos" },
  { value: "inactivos", label: "Dados de baja" },
  { value: "todos", label: "Todos" },
];

interface PaymentRow {
  readonly amount: number;
  readonly payment_method_id: string | null;
  readonly invoice_id: string | null;
}

interface InvoiceForFeeRow {
  readonly id: string;
  readonly amount_gross: number;
}

interface BridgePrincipalRow {
  readonly invoice_id: string;
  readonly bank_movements: { amount: number; kind: "in" | "out" } | null;
}

export default async function MetodosPagoPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const activeParam = parseActive(sp.state);

  const supabase = await createClient();

  const [methods, banks, paymentsRes] = await Promise.all([
    listPaymentMethods(),
    listBanks(),
    // Cobros por método (con link a factura si existe).
    supabase
      .from("payments")
      .select("amount, payment_method_id, invoice_id"),
  ]);
  const payments = (paymentsRes.data ?? []) as unknown as PaymentRow[];

  // Índice cobrado total por método.
  const collectedByMethod = new Map<string, number>();
  for (const p of payments) {
    if (!p.payment_method_id) continue;
    collectedByMethod.set(
      p.payment_method_id,
      (collectedByMethod.get(p.payment_method_id) ?? 0) + Number(p.amount ?? 0),
    );
  }

  // ─── Comisión pasarela acumulada por método (paso 5b) ─────────────────
  //
  // Por factura: gateway_fee = amount_gross − Σ(bridge role='principal',
  // kind='in'). Sólo cuenta cuando la suma es > 0 (factura ya conciliada).
  // Atribución al método: el método del PRIMER payment linkeado a la
  // factura. Modelo típico 1 factura ↔ 1 cobro; si aparece un caso raro
  // (2 cobros con métodos distintos), atribuir al primero es suficiente y
  // no doblamos la comisión.
  const invoiceIds = Array.from(
    new Set(
      payments
        .map((p) => p.invoice_id)
        .filter((id): id is string => id != null),
    ),
  );
  const gatewayFeeByMethod = new Map<string, number>();
  if (invoiceIds.length > 0) {
    const [invRes, bridgeRes] = await Promise.all([
      supabase
        .from("invoices")
        .select("id, amount_gross")
        .in("id", invoiceIds),
      supabase
        .from("invoice_bank_movements")
        .select("invoice_id, bank_movements!inner(amount, kind)")
        .eq("role", "principal")
        .in("invoice_id", invoiceIds),
    ]);
    const invRows = (invRes.data ?? []) as unknown as InvoiceForFeeRow[];
    const bridgeRows = (bridgeRes.data ?? []) as unknown as BridgePrincipalRow[];

    const amountGrossByInvoice = new Map<string, number>();
    for (const r of invRows) {
      amountGrossByInvoice.set(r.id, Number(r.amount_gross));
    }
    const principalSumByInvoice = new Map<string, number>();
    for (const b of bridgeRows) {
      if (!b.bank_movements || b.bank_movements.kind !== "in") continue;
      principalSumByInvoice.set(
        b.invoice_id,
        (principalSumByInvoice.get(b.invoice_id) ?? 0) +
          Number(b.bank_movements.amount),
      );
    }
    const methodByInvoice = new Map<string, string>();
    for (const p of payments) {
      if (!p.invoice_id || !p.payment_method_id) continue;
      if (!methodByInvoice.has(p.invoice_id)) {
        methodByInvoice.set(p.invoice_id, p.payment_method_id);
      }
    }
    for (const [invoiceId, methodId] of methodByInvoice) {
      const gross = amountGrossByInvoice.get(invoiceId);
      const principal = principalSumByInvoice.get(invoiceId);
      if (gross == null || principal == null || principal === 0) continue;
      const fee = Math.max(gross - principal, 0);
      if (fee === 0) continue;
      gatewayFeeByMethod.set(
        methodId,
        (gatewayFeeByMethod.get(methodId) ?? 0) + fee,
      );
    }
  }

  const bankById = new Map(banks.map((b) => [b.id, b]));

  // ─── Filtrar + serializar ─────────────────────────────────────────────
  const filtered = methods.filter((m) => {
    if (activeParam === "activos" && !m.active) return false;
    if (activeParam === "inactivos" && m.active) return false;
    return true;
  });

  const rows: PaymentMethodRowData[] = filtered.map((m) => {
    const bank = m.bank_id ? bankById.get(m.bank_id) ?? null : null;
    return {
      id: m.id,
      name: m.name,
      bankId: m.bank_id,
      bankName: bank?.name ?? null,
      bankActive: bank?.active ?? null,
      effectiveCurrency: effectiveCurrency(m, bank),
      currency: m.currency,
      amountCollected: collectedByMethod.get(m.id) ?? 0,
      gatewayFeeAccumulated: gatewayFeeByMethod.get(m.id) ?? 0,
      active: m.active,
    };
  });

  const totalCount = rows.length;
  // Sumamos separado por moneda — sumar ARS + USD no tiene sentido físico.
  // El total consolidado en USD sale en el dashboard financiero (task #8).
  const totalCollectedARS = rows
    .filter((r) => r.effectiveCurrency === "ARS")
    .reduce((a, r) => a + r.amountCollected, 0);
  const totalCollectedUSD = rows
    .filter((r) => r.effectiveCurrency === "USD")
    .reduce((a, r) => a + r.amountCollected, 0);
  const withoutBank = rows.filter((r) => !r.bankId).length;

  // ─── Opciones para el drawer ──────────────────────────────────────────
  const banksForDrawer: BankOption[] = banks.map((b) => ({
    id: b.id,
    name: b.name,
    currency: b.currency,
    active: b.active,
  }));

  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      <ContextBar
        icon={<IconFin size={16} />}
        title="Métodos de pago"
        stats={[
          { l: "En la vista", v: fCount(totalCount) },
          { l: "Cobrado ARS", v: fmtArs(totalCollectedARS) },
          { l: "Cobrado USD", v: fmtUsd(totalCollectedUSD) },
          {
            l: "Sin banco asignado",
            v: fCount(withoutBank),
            c: withoutBank > 0 ? "#FFB800" : undefined,
          },
        ]}
      />

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <KgParamPills
          ariaLabel="Filtrar por estado"
          options={ACTIVE_OPTIONS.map((o) => ({
            label: o.label,
            href: buildHref({ state: o.value }),
            active: activeParam === o.value,
          }))}
        />
      </div>

      <Panel
        title="Métodos de pago"
        pad={false}
        fillHeight
        actions={<NewPaymentMethodButton banks={banksForDrawer} />}
      >
        <MetodosPagoView
          rows={rows}
          totalCount={totalCount}
          banks={banksForDrawer}
        />
      </Panel>
    </div>
  );
}

function parseActive(v: string | string[] | undefined): ActiveParam {
  if (typeof v !== "string") return "activos";
  const allowed: ActiveParam[] = ["activos", "inactivos", "todos"];
  return (allowed as string[]).includes(v) ? (v as ActiveParam) : "activos";
}

function buildHref(overrides: { state: ActiveParam }): string {
  const params = new URLSearchParams();
  if (overrides.state !== "activos") params.set("state", overrides.state);
  const qs = params.toString();
  return qs ? `/financiero/metodos-pago?${qs}` : "/financiero/metodos-pago";
}
