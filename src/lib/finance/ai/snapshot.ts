import "server-only";

import { computeBankBalances } from "@/lib/banks/balance";
import { listBanks, listBankMovements } from "@/lib/banks/list";
import { loadLatestOrgFxRate, loadOrgFxRatesByMonth } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

import { bucketOfCategory } from "../expense-categories";
import {
  bucketMapFromCategories,
  labelMapFromCategories,
  listExpenseCategories,
} from "../expense-categories-repo";
import type { Ownership } from "../invoice-classification";
import {
  clientBalance,
  computeAccountsPayable,
  computeAccountsReceivable,
  computeBurnRate,
  computeNetWorth,
  computeProfit,
} from "../kpis";
import {
  inPeriodDate,
  inPeriodTs,
  lastClosedMonths,
  lastMonths,
  overlapsPeriodDate,
} from "../period";
import { computeRevenue, type OwnershipResolver } from "../revenue";
import { classifyRunway } from "../runway";
import type {
  FinanceAssetRow,
  FinanceClientTransferRow,
  FinanceExpenseRow,
  FinanceInvoiceRow,
  FinanceLaunchSettlementRow,
  FinanceLiabilityRow,
  FinancePayrollRow,
} from "../types";

import {
  aggregateByCategory,
  aggregatePayrollByPerson,
  detectRecurringExpenses,
  topExpenses,
  unpaidExpenses,
} from "./aggregate";
import type {
  ExpenseDetail,
  FinanceSnapshot,
  MonthlyFinanceRow,
} from "./types";

/**
 * Builder del contexto financiero que consume el chat IA.
 *
 * Replica las MISMAS decisiones contables que el dashboard
 * (`src/app/(app)/(kg)/financiero/page.tsx`): neto de IVA, consolidación a
 * USD con la tasa del mes de devengo, ingreso por percibido, settlements de
 * empresas propias descartados para no contar dos veces. Si estas dos
 * fuentes divergen, la IA cita números que no coinciden con la pantalla —
 * que es la peor forma de perder confianza en un análisis financiero.
 *
 * La ventana es FIJA de 12 meses (no depende del `?range` de la UI): un
 * chat de análisis necesita historia suficiente para distinguir un gasto
 * estructural de uno puntual.
 */

const WINDOW_MONTHS = 12;

// ═══════════════════════════════════════════════════════════════════════════
// Shapes de fetch — subsets con las columnas extra que el snapshot necesita
// ═══════════════════════════════════════════════════════════════════════════
interface ExpenseDbRow extends FinanceExpenseRow {
  readonly id: string;
  readonly description: string | null;
  readonly supplier_id: string | null;
}
interface PayrollDbRow extends FinancePayrollRow {
  readonly person_id: string | null;
}
interface SettlementDbRow extends FinanceLaunchSettlementRow {
  readonly launch_id: string;
  readonly project_id: string;
}
interface PayoutDbRow {
  readonly launch_id: string;
  readonly amount: number;
  readonly paid_at: string;
}
interface NamedRow {
  readonly id: string;
  readonly name: string | null;
}
interface PersonRow {
  readonly id: string;
  readonly full_name: string | null;
}
interface LaunchFxRow {
  readonly id: string;
  readonly ars_per_usd: number | null;
}
interface ProjectOwnershipRow {
  readonly id: string;
  readonly name: string | null;
  readonly ownership: "propia" | "externa";
}
interface ProjectFxMonthlyRow {
  readonly project_id: string;
  readonly month: string;
  readonly ars_per_usd: number;
}

export async function buildFinanceSnapshot(
  now: Date = new Date(),
): Promise<FinanceSnapshot> {
  const supabase = await createClient();

  const buckets = lastMonths(WINDOW_MONTHS, now);
  const windowFromYmd = buckets[0]!.fromYmd;
  const windowToYmd = buckets[buckets.length - 1]!.toYmd;
  const monthKeys = buckets.map((b) => b.key);
  // "Último mes cerrado": el anterior al que corre. Con la ventana de 12 el
  // penúltimo bucket siempre existe, pero el guard evita un undefined si
  // alguien baja WINDOW_MONTHS a 1.
  const lastClosedMonthKey =
    buckets.length >= 2 ? buckets[buckets.length - 2]!.key : buckets[0]!.key;

  // Ventana del burn: 3 meses calendario CERRADOS (misma regla que el
  // dashboard — el mes en curso está incompleto y deprimiría el burn).
  const burnWindow = lastClosedMonths(3, now);
  const payoutsFrom =
    burnWindow.fromYmd < windowFromYmd ? burnWindow.fromYmd : windowFromYmd;

  const [
    expensesRes,
    payrollRes,
    invoicesRes,
    settlementsRes,
    payoutsRes,
    assetsRes,
    liabilitiesRes,
    clientTransfersRes,
    banksList,
    allBankMovements,
    latestFx,
    orgFxByMonth,
    categoriesCatalog,
  ] = await Promise.all([
    // `.or(...)` para traer la ventana Y todo lo impago fuera de ella: las
    // cuentas por pagar viejas son justamente lo que hay que mostrar.
    supabase
      .from("expenses")
      .select(
        "id, description, category, amount_gross, tax_amount, currency, expense_date, paid_at, due_date, project_id, supplier_id",
      )
      .or(`expense_date.gte.${windowFromYmd},paid_at.is.null`),
    supabase
      .from("payroll")
      .select(
        "person_id, total_amount, currency, paid_at, due_date, period_start, period_end",
      )
      .or(`period_start.gte.${windowFromYmd},paid_at.is.null`),
    supabase
      .from("invoices")
      .select(
        "project_id, launch_id, amount_gross, tax_amount, currency, status, paid_at, due_date, issue_date",
      )
      .or(`paid_at.is.null,paid_at.gte.${windowFromYmd}`),
    supabase
      .from("launch_settlements")
      .select(
        "kingrow_retained, status, closed_at, created_at, launch_id, project_id",
      )
      .gte("closed_at", windowFromYmd),
    supabase
      .from("team_member_payouts")
      .select("launch_id, amount, paid_at")
      .gte("paid_at", payoutsFrom)
      .lte("paid_at", windowToYmd),
    supabase.from("assets").select("amount, currency, active"),
    supabase.from("liabilities").select("amount, currency, active, settled_at"),
    supabase.from("client_transfers").select("amount, direction, date"),
    listBanks(),
    listBankMovements(),
    loadLatestOrgFxRate(supabase),
    loadOrgFxRatesByMonth(supabase),
    listExpenseCategories(supabase),
  ]);

  // Cast en el borde — los types generados están viejos (mismo patrón que
  // el resto del módulo financiero).
  const expenseRows = (expensesRes.data ?? []) as ExpenseDbRow[];
  const payrollRows = (payrollRes.data ?? []) as PayrollDbRow[];
  const invoices = (invoicesRes.data ?? []) as FinanceInvoiceRow[];
  const settlements = (settlementsRes.data ?? []) as SettlementDbRow[];
  const payouts = (payoutsRes.data ?? []) as PayoutDbRow[];
  const assets = (assetsRes.data ?? []) as FinanceAssetRow[];
  const liabilities = (liabilitiesRes.data ?? []) as FinanceLiabilityRow[];
  const clientTransfers = (clientTransfersRes.data ??
    []) as FinanceClientTransferRow[];

  const bucketBySlug = bucketMapFromCategories(categoriesCatalog);
  const labelBySlug = labelMapFromCategories(categoriesCatalog);

  // ─── Nombres de referencia (proveedor / persona / proyecto / launch) ────
  const supplierIds = uniq(expenseRows.map((e) => e.supplier_id));
  const personIds = uniq(payrollRows.map((p) => p.person_id));
  const launchIds = uniq([
    ...settlements.map((s) => s.launch_id),
    ...payouts.map((p) => p.launch_id),
  ]);
  const projectIds = uniq([
    ...invoices.map((i) => i.project_id),
    ...settlements.map((s) => s.project_id),
    ...expenseRows.map((e) => e.project_id),
  ]);

  const [suppliersRes, peopleRes, launchesRes, projectsRes, projectFxRes] =
    await Promise.all([
      supplierIds.length > 0
        ? supabase.from("suppliers").select("id, name").in("id", supplierIds)
        : Promise.resolve({ data: [] }),
      personIds.length > 0
        ? supabase
            .from("organization_people")
            .select("id, full_name")
            .in("id", personIds)
        : Promise.resolve({ data: [] }),
      launchIds.length > 0
        ? supabase
            .from("launches")
            .select("id, ars_per_usd")
            .in("id", launchIds)
        : Promise.resolve({ data: [] }),
      projectIds.length > 0
        ? supabase
            .from("projects")
            .select("id, name, ownership")
            .in("id", projectIds)
        : Promise.resolve({ data: [] }),
      projectIds.length > 0
        ? supabase
            .from("project_fx_rates")
            .select("project_id, month, ars_per_usd")
            .in("project_id", projectIds)
        : Promise.resolve({ data: [] }),
    ]);

  const supplierNameById = nameMap((suppliersRes.data ?? []) as NamedRow[]);
  const personNameById = new Map<string, string>(
    ((peopleRes.data ?? []) as PersonRow[]).map((p) => [
      p.id,
      p.full_name ?? "Sin nombre",
    ]),
  );
  const launchRateById = new Map<string, number | null>(
    ((launchesRes.data ?? []) as LaunchFxRow[]).map((l) => [
      l.id,
      l.ars_per_usd,
    ]),
  );
  const projectRows = (projectsRes.data ?? []) as ProjectOwnershipRow[];
  const projectNameById = new Map<string, string>(
    projectRows.map((p) => [p.id, p.name ?? "Proyecto sin nombre"]),
  );
  const ownershipByProjectId = new Map<string, Ownership>(
    projectRows.map((p) => [p.id, p.ownership]),
  );
  const resolveOwnership: OwnershipResolver = (projectId) =>
    projectId == null ? null : ownershipByProjectId.get(projectId) ?? null;

  const fxByProjectMonth = new Map<string, number>();
  for (const r of (projectFxRes.data ?? []) as ProjectFxMonthlyRow[]) {
    fxByProjectMonth.set(
      `${r.project_id}:${r.month.slice(0, 7)}`,
      r.ars_per_usd,
    );
  }
  const orgLatestRate = latestFx && latestFx.rate > 0 ? latestFx.rate : null;

  // ═══════════════════════════════════════════════════════════════════════
  // Conversión a USD — mismas reglas que el dashboard
  // ═══════════════════════════════════════════════════════════════════════
  function resolveOrgRateForMonth(ymd: string): number | null {
    const rateMonth = orgFxByMonth.get(ymd.slice(0, 7));
    if (rateMonth != null && rateMonth > 0) return rateMonth;
    return orgLatestRate;
  }
  function orgAmountToUsd(
    amount: number,
    currency: "ARS" | "USD",
    anchorYmd: string,
  ): number {
    if (currency === "USD") return amount;
    const rate = resolveOrgRateForMonth(anchorYmd);
    return rate != null ? amount / rate : amount;
  }
  function invoiceToUsd(amount: number, i: FinanceInvoiceRow): number {
    if (i.currency === "USD") return amount;
    const anchor = i.paid_at ?? i.issue_date;
    const pid = i.project_id;
    const rate =
      pid != null
        ? fxByProjectMonth.get(`${pid}:${anchor.slice(0, 7)}`)
        : undefined;
    if (rate != null && rate > 0) return amount / rate;
    if (orgLatestRate != null) return amount / orgLatestRate;
    return amount;
  }
  function launchAmountToUsd(amount: number, launchId: string): number {
    const rate = launchRateById.get(launchId) ?? null;
    if (rate == null || rate <= 0) return amount;
    return amount / rate;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Gastos → detalle normalizado (la materia prima del análisis)
  // ═══════════════════════════════════════════════════════════════════════
  const expensesUsd: FinanceExpenseRow[] = expenseRows.map((e) => ({
    ...e,
    amount_gross: orgAmountToUsd(e.amount_gross, e.currency, e.expense_date),
    tax_amount: orgAmountToUsd(e.tax_amount, e.currency, e.expense_date),
  }));

  const expenseDetails: ExpenseDetail[] = expenseRows.map((e) => ({
    id: e.id,
    description: (e.description ?? "").trim() || "Sin descripción",
    category: e.category,
    netUsd:
      orgAmountToUsd(e.amount_gross, e.currency, e.expense_date) -
      orgAmountToUsd(e.tax_amount, e.currency, e.expense_date),
    currency: e.currency,
    nativeGross: e.amount_gross,
    expenseDate: e.expense_date,
    paidAt: e.paid_at,
    dueDate: e.due_date,
    supplierName:
      e.supplier_id != null
        ? supplierNameById.get(e.supplier_id) ?? null
        : null,
    projectName:
      e.project_id != null ? projectNameById.get(e.project_id) ?? null : null,
  }));

  // Los agregados de "estructura de gasto" miran SOLO la ventana: un impago
  // de hace dos años entra al fetch por el `.or(paid_at.is.null)` pero no
  // debe distorsionar promedios mensuales ni participaciones.
  const expensesInWindow = expenseDetails.filter(
    (e) => e.expenseDate >= windowFromYmd && e.expenseDate <= windowToYmd,
  );

  const payrollUsd: FinancePayrollRow[] = payrollRows.map((p) => ({
    ...p,
    total_amount: orgAmountToUsd(p.total_amount, p.currency, p.period_start),
  }));
  const payrollInWindow = payrollRows
    .filter((p) => overlapsPeriodDate(p.period_start, p.period_end, {
      fromYmd: windowFromYmd,
      toYmd: windowToYmd,
    }))
    .map((p) => ({
      personName:
        p.person_id != null
          ? personNameById.get(p.person_id) ?? "Sin nombre"
          : "Sin asignar",
      totalUsd: orgAmountToUsd(p.total_amount, p.currency, p.period_start),
    }));

  const invoicesUsd: FinanceInvoiceRow[] = invoices.map((i) => ({
    ...i,
    amount_gross: invoiceToUsd(i.amount_gross, i),
    tax_amount: invoiceToUsd(i.tax_amount, i),
  }));
  // Settlements de empresas propias fuera: su ingreso ya entra por facturas
  // cobradas (regla de percibido del dashboard). Contarlos sería doble.
  const settlementsUsd = settlements
    .filter((s) => ownershipByProjectId.get(s.project_id) !== "propia")
    .map((s) => ({
      ...s,
      kingrow_retained: launchAmountToUsd(s.kingrow_retained, s.launch_id),
    }));
  const clientTransfersUsd: FinanceClientTransferRow[] = clientTransfers.map(
    (t) => ({ ...t, amount: orgAmountToUsd(t.amount, "ARS", t.date) }),
  );
  const assetsUsd: FinanceAssetRow[] = assets.map((a) => ({
    ...a,
    amount:
      a.currency === "USD" || orgLatestRate == null
        ? a.amount
        : a.amount / orgLatestRate,
  }));
  const liabilitiesUsd: FinanceLiabilityRow[] = liabilities.map((l) => ({
    ...l,
    amount:
      l.currency === "USD" || orgLatestRate == null
        ? l.amount
        : l.amount / orgLatestRate,
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // Serie mensual — 12 filas de P&L
  // ═══════════════════════════════════════════════════════════════════════
  const monthly: MonthlyFinanceRow[] = buckets.map((b) => {
    const rev = computeRevenue({
      settlements: settlementsUsd.filter((s) => inPeriodTs(s.closed_at, b)),
      invoices: invoicesUsd.filter((i) => inPeriodDate(i.paid_at, b)),
      resolveOwnership,
    });
    const monthExpenses = expensesUsd.filter((e) =>
      inPeriodDate(e.expense_date, b),
    );
    const split = { direct: 0, tax: 0, operating: 0 };
    for (const e of monthExpenses) {
      split[bucketOfCategory(e.category, bucketBySlug)] +=
        e.amount_gross - e.tax_amount;
    }
    const monthPayouts = payouts
      .filter((p) => inPeriodDate(p.paid_at, b))
      .reduce((acc, p) => acc + launchAmountToUsd(p.amount, p.launch_id), 0);
    const monthPayroll = payrollUsd
      .filter((p) => overlapsPeriodDate(p.period_start, p.period_end, b))
      .reduce((acc, p) => acc + p.total_amount, 0);

    const profit = computeProfit({
      revenue: rev.revenueTotal,
      directCosts: split.direct + monthPayouts,
      operatingExpenses: split.operating,
      payroll: monthPayroll,
      taxes: split.tax,
    });
    return {
      key: b.key,
      label: b.label,
      revenueUsd: rev.revenueTotal,
      directUsd: split.direct + monthPayouts,
      operatingUsd: split.operating,
      taxesUsd: split.tax,
      payrollUsd: monthPayroll,
      netProfitUsd: profit.netProfit,
    };
  });

  const totals = monthly.reduce(
    (acc, m) => ({
      revenueUsd: acc.revenueUsd + m.revenueUsd,
      expensesNetUsd:
        acc.expensesNetUsd + m.directUsd + m.operatingUsd + m.taxesUsd,
      payrollUsd: acc.payrollUsd + m.payrollUsd,
      netProfitUsd: acc.netProfitUsd + m.netProfitUsd,
    }),
    { revenueUsd: 0, expensesNetUsd: 0, payrollUsd: 0, netProfitUsd: 0 },
  );
  const payoutsUsdWindow = payouts
    .filter((p) => p.paid_at >= windowFromYmd && p.paid_at <= windowToYmd)
    .reduce((acc, p) => acc + launchAmountToUsd(p.amount, p.launch_id), 0);

  // ═══════════════════════════════════════════════════════════════════════
  // Posición: caja, burn, runway, AR/AP, patrimonio
  // ═══════════════════════════════════════════════════════════════════════
  const activeBanks = banksList.filter(
    (b) => b.active && !b.is_external_collector,
  );
  const bankBalances = computeBankBalances(activeBanks, allBankMovements);
  let banksArsNative = 0;
  let banksUsdNative = 0;
  for (const b of activeBanks) {
    const total = bankBalances.get(b.id)?.total ?? Number(b.opening_balance);
    if (b.currency === "USD") banksUsdNative += total;
    else banksArsNative += total;
  }
  let cashUsd: number | null;
  if (banksArsNative === 0) cashUsd = banksUsdNative;
  else if (orgLatestRate != null)
    cashUsd = banksUsdNative + banksArsNative / orgLatestRate;
  else cashUsd = null;

  const burnPayouts = payouts
    .filter((p) => inPeriodDate(p.paid_at, burnWindow))
    .reduce((acc, p) => acc + launchAmountToUsd(p.amount, p.launch_id), 0);
  const burn = computeBurnRate({
    expenses: expensesUsd.filter((e) => inPeriodDate(e.expense_date, burnWindow)),
    payroll: payrollUsd.filter((p) =>
      overlapsPeriodDate(p.period_start, p.period_end, burnWindow),
    ),
    monthsInWindow: burnWindow.monthsInWindow,
    otherCosts: burnPayouts,
  });
  const runway = classifyRunway({
    cashOnHand: cashUsd,
    monthlyBurn: burn,
    snapshotStale: false,
  });

  const ar = computeAccountsReceivable({
    invoices: invoicesUsd,
    resolveOwnership,
    favorKingrowBalance: Math.max(-clientBalance(clientTransfersUsd), 0),
  });
  const ap = computeAccountsPayable({
    expenses: expensesUsd,
    payroll: payrollUsd,
    clientTransfers: clientTransfersUsd,
  });
  const netWorth = computeNetWorth({
    assets: assetsUsd,
    liabilities: liabilitiesUsd,
    currentPayables: ap.totalPayable,
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Avisos de calidad de dato — la IA los tiene que explicitar, no tapar
  // ═══════════════════════════════════════════════════════════════════════
  const warnings: string[] = [];
  const hasArs =
    expenseRows.some((e) => e.currency === "ARS") ||
    payrollRows.some((p) => p.currency === "ARS");
  if (hasArs && orgLatestRate == null) {
    warnings.push(
      "No hay ninguna tasa ARS/USD cargada: los montos en pesos se están tomando como si fueran dólares. Todos los totales están distorsionados.",
    );
  }
  if (cashUsd == null) {
    warnings.push(
      "Hay saldo bancario en ARS sin tasa del mes: la caja consolidada y el runway no se pueden calcular.",
    );
  }
  const sinCategoria = expensesInWindow.filter(
    (e) => e.category == null || e.category.trim() === "",
  );
  if (sinCategoria.length > 0) {
    const monto = sinCategoria.reduce((acc, e) => acc + e.netUsd, 0);
    warnings.push(
      `${sinCategoria.length} gastos de la ventana no tienen categoría (USD ${Math.round(monto)}): el análisis por categoría los agrupa como "Sin categoría".`,
    );
  }

  return {
    generatedAt: new Date(now).toISOString(),
    windowFromYmd,
    windowToYmd,
    windowMonths: WINDOW_MONTHS,
    lastClosedMonthKey,
    monthly,
    categories: aggregateByCategory(expensesInWindow, {
      monthKeys,
      lastMonthKey: lastClosedMonthKey,
      labelBySlug,
      bucketBySlug,
    }),
    recurring: detectRecurringExpenses(expensesInWindow, {
      minMonths: 3,
      limit: 25,
    }),
    topExpenses: topExpenses(expensesInWindow, 30),
    unpaidExpenses: unpaidExpenses(expenseDetails, 20),
    payrollByPerson: aggregatePayrollByPerson(payrollInWindow),
    totals: {
      revenueUsd: totals.revenueUsd,
      expensesNetUsd: totals.expensesNetUsd,
      payrollUsd: totals.payrollUsd,
      payoutsUsd: payoutsUsdWindow,
      netProfitUsd: totals.netProfitUsd,
      marginPct:
        totals.revenueUsd > 0 ? totals.netProfitUsd / totals.revenueUsd : 0,
    },
    position: {
      cashUsd,
      activeBanks: activeBanks.length,
      burnMonthlyUsd: burn,
      runwayMonths: runway.months,
      runwayReason: runway.reason,
      receivableUsd: ar.totalReceivable,
      payableUsd: ap.totalPayable,
      netWorthUsd: netWorth.netWorth,
    },
    fx: {
      latestRate: orgLatestRate,
      latestRateMonth: latestFx?.month ?? null,
    },
    warnings,
  };
}

function uniq(values: ReadonlyArray<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.filter((v): v is string => typeof v === "string" && v !== "")),
  );
}

function nameMap(rows: readonly NamedRow[]): Map<string, string> {
  return new Map(rows.map((r) => [r.id, r.name ?? "Sin nombre"]));
}
