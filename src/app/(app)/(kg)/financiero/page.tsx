import type { Metadata } from "next";

import {
  clientBalance,
  computeAccountsPayable,
  computeAccountsReceivable,
  computeBurnRate,
  computeCashFlow,
  computeNetWorth,
  computeProfit,
  computeRunway,
  sumExpensesNet,
  sumPayrollTotal,
} from "@/lib/finance/kpis";
import { fPct } from "@/lib/finance/format";
import {
  inPeriod,
  lastMonths,
  overlapsPeriod,
  resolvePeriod,
} from "@/lib/finance/period";
import { computeRevenue } from "@/lib/finance/revenue";
import type {
  FinanceAssetRow,
  FinanceBankMovementRow,
  FinanceClientTransferRow,
  FinanceExpenseRow,
  FinanceInvoiceRow,
  FinanceLaunchSettlementRow,
  FinanceLiabilityRow,
  FinancePayrollRow,
} from "@/lib/finance/types";
import { createClient } from "@/lib/supabase/server";

import {
  FinancieroDashboard,
  type FinancieroDashboardData,
  type LaunchSettlementRow,
} from "./dashboard";

export const metadata: Metadata = { title: "Financiero" };

// La ventana en meses del snapshot de caja después de la cual `runway` se
// vuelve `—`. Un runway con snapshot viejo y cara de certeza es peor que
// ningún runway (decisión del bloque 6b, sección 1.1).
const CASH_SNAPSHOT_STALE_DAYS = 45;
const CASH_ASSET_TYPES: readonly string[] = ["caja", "banco"];
const MS_PER_DAY = 1000 * 60 * 60 * 24;

// ═══════════════════════════════════════════════════════════════════════════
// Row shapes con los campos adicionales que la page necesita para armar
// panels/detalles (más allá de lo que consumen los selectores puros). Los
// selectores solo leen el subset declarado en `finance/types.ts`.
// ═══════════════════════════════════════════════════════════════════════════
type SettlementRowWithMeta = FinanceLaunchSettlementRow & {
  readonly launch_id: string;
  readonly collected_total: number;
  readonly owed_to_client: number;
};
type ExpenseRowWithMeta = FinanceExpenseRow;
type AssetRowWithMeta = FinanceAssetRow & {
  readonly asset_type: string;
  readonly updated_at: string;
};
type LaunchNameRow = { readonly id: string; readonly name: string | null };

export default async function FinancieroPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const rangeParam = typeof sp.range === "string" ? sp.range : null;
  const period = resolvePeriod({ range: rangeParam });

  const supabase = await createClient();

  // ───────────── Fetch: RLS org-scope filtra por `can_edit_organization`.
  // Un rol cliente ni siquiera llega acá (el gate está en `(app)/layout.tsx`);
  // aunque llegara, la RLS le devuelve arrays vacíos. Las escrituras están
  // fuera del alcance de 6b — no importamos ni ejecutamos server actions.
  const [
    settlementsRes,
    invoicesRes,
    expensesRes,
    payrollRes,
    assetsRes,
    liabilitiesRes,
    clientTransfersRes,
    bankMovementsRes,
  ] = await Promise.all([
    supabase
      .from("launch_settlements")
      .select(
        "kingrow_retained, collected_total, owed_to_client, status, closed_at, created_at, launch_id",
      ),
    supabase
      .from("invoices")
      .select(
        "amount_gross, tax_amount, status, paid_at, due_date, issue_date",
      ),
    supabase
      .from("expenses")
      .select(
        "amount_gross, tax_amount, category, paid_at, due_date, expense_date",
      ),
    supabase
      .from("payroll")
      .select("total_amount, paid_at, due_date, period_start, period_end"),
    supabase
      .from("assets")
      .select("amount, active, asset_type, updated_at"),
    supabase.from("liabilities").select("amount, active, settled_at"),
    supabase.from("client_transfers").select("amount, direction, date"),
    supabase.from("bank_movements").select("amount, kind, occurred_at"),
  ]);

  // Cast en el borde — postgrest-js colapsa a `never` sobre el Database
  // generado (patrón documentado en memoria). Los shapes son los subsets
  // que los selectores esperan; columnas extra se ignoran silenciosamente.
  const settlements = (settlementsRes.data ?? []) as SettlementRowWithMeta[];
  const invoices = (invoicesRes.data ?? []) as FinanceInvoiceRow[];
  const expenses = (expensesRes.data ?? []) as ExpenseRowWithMeta[];
  const payroll = (payrollRes.data ?? []) as FinancePayrollRow[];
  const assets = (assetsRes.data ?? []) as AssetRowWithMeta[];
  const liabilities = (liabilitiesRes.data ?? []) as FinanceLiabilityRow[];
  const clientTransfers = (clientTransfersRes.data ??
    []) as FinanceClientTransferRow[];
  const bankMovements = (bankMovementsRes.data ?? []) as FinanceBankMovementRow[];

  // Nombres de lanzamientos para el panel "Liquidaciones por lanzamiento".
  // Si RLS de `launches` no deja leer (project-scope), caemos a launch_id
  // truncado — no rompe el dashboard.
  const launchIds = Array.from(new Set(settlements.map((s) => s.launch_id)));
  let launchNameById = new Map<string, string>();
  if (launchIds.length > 0) {
    const launchesRes = await supabase
      .from("launches")
      .select("id, name")
      .in("id", launchIds);
    const launchRows = (launchesRes.data ?? []) as LaunchNameRow[];
    launchNameById = new Map(
      launchRows.map((l) => [l.id, l.name ?? `Lanzamiento ${l.id.slice(0, 6)}`]),
    );
  }

  // ═════════════════════════════════════════════════════════════════════════
  // Filtrado por período — hecho acá (no en el selector), respetando la regla
  // acordada: los selectores no filtran por fecha, el caller pasa rows filtr.
  // ═════════════════════════════════════════════════════════════════════════
  const settlementsInPeriod = settlements.filter((s) =>
    inPeriod(s.closed_at, period),
  );
  const invoicesRevenueInPeriod = invoices.filter((i) => inPeriod(i.paid_at, period));
  const expensesInPeriod = expenses.filter((e) =>
    inPeriod(e.expense_date, period),
  );
  const payrollInPeriod = payroll.filter((p) =>
    overlapsPeriod(p.period_start, p.period_end, period),
  );
  const bankMovementsInPeriod = bankMovements.filter((m) =>
    inPeriod(m.occurred_at, period),
  );
  const clientTransfersInPeriod = clientTransfers.filter((t) =>
    inPeriod(t.date, period),
  );

  // ═════════════════════════════════════════════════════════════════════════
  // KPIs — todos vienen de selectores puros.
  // ═════════════════════════════════════════════════════════════════════════
  const revenue = computeRevenue({
    settlements: settlementsInPeriod,
    invoices: invoicesRevenueInPeriod,
  });

  const opExNet = sumExpensesNet(expensesInPeriod);
  const payrollTotal = sumPayrollTotal(payrollInPeriod);

  // 6b: directCosts=0 y taxes=0 hasta que exista clasificación real. La
  // consecuencia es que grossProfit = revenue — por eso el dashboard NO
  // muestra margen bruto (decisión 1.3). Este comentario queda como REVISAR
  // CON CONTADOR (además del ya presente en `kpis.ts`).
  const profit = computeProfit({
    revenue: revenue.revenueTotal,
    directCosts: 0,
    operatingExpenses: opExNet,
    payroll: payrollTotal,
    taxes: 0,
  });

  const ar = computeAccountsReceivable({
    invoices, // AR = todas las pendientes, sin filtro de período
    favorKingrowBalance: Math.max(-clientBalance(clientTransfers), 0),
  });
  const ap = computeAccountsPayable({
    expenses, // AP = todas las devengadas no pagadas, sin filtro de período
    payroll,
    clientTransfers,
  });
  const netWorth = computeNetWorth({
    assets,
    liabilities,
    currentPayables: ap.totalPayable,
  });
  const cashFlow = computeCashFlow({ bankMovements: bankMovementsInPeriod });

  // ─── Caja: opción A del reporte — snapshot desde `assets` tipo caja/banco.
  // Nunca se rellena con 0 si no hay activos: la UI muestra EmptyKpiCard.
  const cashAssets = assets.filter(
    (a) => a.active && CASH_ASSET_TYPES.includes(a.asset_type),
  );
  const cashOnHand = cashAssets.reduce((acc, a) => acc + a.amount, 0);
  const latestSnapshotMs = cashAssets.reduce((max, a) => {
    const t = new Date(a.updated_at).getTime();
    return Number.isFinite(t) && t > max ? t : max;
  }, 0);
  const cashSnapshotDate = latestSnapshotMs > 0 ? new Date(latestSnapshotMs).toISOString() : null;
  const ageDays =
    latestSnapshotMs > 0
      ? Math.floor((Date.now() - latestSnapshotMs) / MS_PER_DAY)
      : null;
  const stale = ageDays != null && ageDays > CASH_SNAPSHOT_STALE_DAYS;

  const burn = computeBurnRate({
    expenses: expensesInPeriod,
    payroll: payrollInPeriod,
    monthsInWindow: period.monthsInWindow,
  });

  // Runway `undefined` cuando el snapshot está stale — la UI muestra "—".
  // Runway `null` cuando burn ≤ 0 → "∞". Runway `number` en cualquier otro
  // caso. La distinción viaja explícita hasta el componente.
  const runwayMonths = stale
    ? undefined
    : computeRunway({ cashOnHand, monthlyBurn: burn });

  // ═════════════════════════════════════════════════════════════════════════
  // Tendencia mensual (12 meses) — únicamente revenue. Es la ÚNICA serie
  // temporal real a nivel org (regla del artefacto, sección 4 del OK).
  // ═════════════════════════════════════════════════════════════════════════
  const buckets = lastMonths(12);
  const revenueBuckets = buckets.map((b) => {
    const rev = computeRevenue({
      settlements: settlements.filter((s) => {
        if (!s.closed_at) return false;
        const t = new Date(s.closed_at).getTime();
        return t >= b.from.getTime() && t <= b.to.getTime();
      }),
      invoices: invoices.filter((i) => {
        if (!i.paid_at) return false;
        const t = new Date(i.paid_at).getTime();
        return t >= b.from.getTime() && t <= b.to.getTime();
      }),
    });
    return { label: b.label, revenue: rev.revenueTotal };
  });

  // Delta MoM: último mes completo vs anterior. Si el buffer último es el
  // mes en curso incompleto, comparar contra el mismo tramo del anterior
  // sería más justo — para 6b uso mes completo vs mes completo (bucket -2
  // vs bucket -3), y solo si ambos > 0.
  let revDelta: { value: string; dir: "up" | "down" } | null = null;
  if (revenueBuckets.length >= 3) {
    const lastFull = revenueBuckets[revenueBuckets.length - 2];
    const prevFull = revenueBuckets[revenueBuckets.length - 3];
    if (lastFull && prevFull && prevFull.revenue > 0) {
      const pct = (lastFull.revenue - prevFull.revenue) / prevFull.revenue;
      revDelta = { value: fPct(Math.abs(pct)), dir: pct >= 0 ? "up" : "down" };
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // Estructura de egresos — expenses agrupados por category + payroll.
  // ═════════════════════════════════════════════════════════════════════════
  const catMap = new Map<string, number>();
  for (const e of expensesInPeriod) {
    const cat = (e.category ?? "Sin categoría").trim() || "Sin categoría";
    const net = e.amount_gross - e.tax_amount;
    catMap.set(cat, (catMap.get(cat) ?? 0) + net);
  }
  const expenseCategories: FinancieroDashboardData["expenseCategories"] = [
    ...Array.from(catMap.entries())
      .map(([label, amount]) => ({ label: capitalize(label), amount }))
      .sort((a, b) => b.amount - a.amount),
    ...(payrollTotal > 0 ? [{ label: "Nómina", amount: payrollTotal }] : []),
  ];

  // ═════════════════════════════════════════════════════════════════════════
  // Liquidaciones por lanzamiento — filas del período con nombre del launch.
  // ═════════════════════════════════════════════════════════════════════════
  const launchSettlements: LaunchSettlementRow[] = settlementsInPeriod
    .slice()
    .sort((a, b) => (b.closed_at ?? "").localeCompare(a.closed_at ?? ""))
    .slice(0, 20)
    .map((s) => ({
      launchName:
        launchNameById.get(s.launch_id) ?? `Lanzamiento ${s.launch_id.slice(0, 6)}`,
      collected: s.collected_total,
      retained: s.kingrow_retained,
      owed: s.owed_to_client,
      status: s.status,
    }));

  // ═════════════════════════════════════════════════════════════════════════
  // P&L breakdown para el panel "Estado de resultados".
  // Ingresos (+), Gastos operativos (−), Nómina (−). Impuestos omitido en 6b.
  // ═════════════════════════════════════════════════════════════════════════
  const plParts: FinancieroDashboardData["plParts"] = [
    { l: "Ingresos", v: revenue.revenueTotal },
    { l: "Gastos operativos", v: -opExNet },
    { l: "Nómina", v: -payrollTotal },
  ];

  // ═════════════════════════════════════════════════════════════════════════
  // Sources — metadata declarada en UN solo lugar (acá). El drawer los renderiza.
  // ═════════════════════════════════════════════════════════════════════════
  const data: FinancieroDashboardData = {
    period: {
      key: period.key,
      label: period.label,
      rangeStart: period.from.toISOString(),
      rangeEnd: period.to.toISOString(),
    },
    counts: {
      invoicesPending: ar.invoicesCount,
      settlementsInPeriod: settlementsInPeriod.length,
      expensesInPeriod: expensesInPeriod.length,
      payrollInPeriod: payrollInPeriod.length,
    },
    stats: {
      expensesTotal: opExNet,
      payrollTotal,
      clientBalance: clientBalance(clientTransfersInPeriod),
    },
    revenue: {
      value: revenue.revenueTotal,
      tone: "positive",
      parts: [
        { l: "Liquidaciones (Kingrow retenido)", v: revenue.revenueFromSettlements },
        { l: "Facturas cobradas (neto)", v: revenue.revenueFromInvoices },
        { l: "Otros ingresos", v: revenue.otherIncome },
      ],
      sources: [
        {
          table: "launch_settlements",
          field: "kingrow_retained",
          cond: "status ∈ {liquidada, transferida}",
        },
        {
          table: "invoices",
          field: "amount_gross − tax_amount",
          cond: "status = cobrada",
        },
      ],
    },
    revenueSeries: { buckets: revenueBuckets, delta: revDelta },
    netProfit: {
      value: profit.netProfit,
      tone: profit.netProfit >= 0 ? "positive" : "negative",
      parts: [
        { l: "Ingresos", v: revenue.revenueTotal },
        { l: "Gastos operativos (neto IVA)", v: -opExNet },
        { l: "Nómina", v: -payrollTotal },
      ],
      sources: [
        { table: "launch_settlements + invoices", field: "revenue derivado" },
        { table: "expenses", field: "amount_gross − tax_amount", cond: `expense_date ∈ período` },
        { table: "payroll", field: "total_amount", cond: "período solapado" },
      ],
    },
    cash: {
      cashOnHand,
      snapshotDate: cashSnapshotDate,
      ageDays,
      stale,
      bucketCount: cashAssets.length,
    },
    runway: { months: runwayMonths, stale },
    burn,
    cashFlow: {
      value: cashFlow.netCashFlow,
      tone: cashFlow.netCashFlow >= 0 ? "positive" : "negative",
      parts: [
        { l: "Entradas", v: cashFlow.cashIn },
        { l: "Salidas", v: -cashFlow.cashOut },
      ],
      sources: [
        {
          table: "bank_movements",
          field: "amount",
          cond: `kind ∈ {in,out} · occurred_at ∈ período`,
        },
      ],
    },
    margin: profit.netMargin,
    ar: {
      value: ar.totalReceivable,
      tone: "warning",
      parts: [
        { l: "Facturas por cobrar (neto)", v: ar.invoicesReceivableNet },
        { l: "Saldo a favor de Kingrow", v: ar.favorKingrowBalance },
      ],
      sources: [
        {
          table: "invoices",
          field: "amount_gross − tax_amount",
          cond: "status ∉ {cobrada, anulada}",
        },
        {
          table: "client_transfers",
          field: "clamp(−balance, 0)",
          cond: "clientes que nos deben",
        },
      ],
    },
    ap: {
      value: ap.totalPayable,
      tone: "negative",
      parts: [
        { l: "Gastos por pagar (neto)", v: ap.expensesPayableNet },
        { l: "Nómina por pagar", v: ap.payrollPayable },
        { l: "Debido a clientes", v: ap.clientPayable },
      ],
      sources: [
        { table: "expenses", field: "amount_gross − tax_amount", cond: "paid_at IS NULL" },
        { table: "payroll", field: "total_amount", cond: "paid_at IS NULL" },
        { table: "client_transfers", field: "max(balance, 0)" },
      ],
    },
    equity: {
      value: netWorth.netWorth,
      tone: netWorth.netWorth >= 0 ? "positive" : "negative",
      parts: [
        { l: "Activos", v: netWorth.totalAssets },
        { l: "Pasivos", v: -netWorth.totalLiabilities },
        { l: "Cuentas por pagar corrientes", v: -netWorth.currentPayables },
      ],
      sources: [
        { table: "assets", field: "amount", cond: "active = true" },
        {
          table: "liabilities",
          field: "amount",
          cond: "active AND settled_at IS NULL",
        },
        { table: "expenses+payroll+client_transfers", field: "AP corriente (derivado)" },
      ],
    },
    plParts,
    plNet: profit.netProfit,
    expenseCategories,
    launchSettlements,
  };

  return <FinancieroDashboard data={data} />;
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
