import type { Metadata } from "next";
import Link from "next/link";

import { ContextBar } from "@/components/kg/context-bar";
import { EmptyState } from "@/components/kg/empty-state";
import { IconExec } from "@/components/kg/icons";
import { Panel } from "@/components/kg/panel";
import { StatusPill } from "@/components/kg/status-pill";
import {
  activeStudents as computeActiveStudents,
  averageAttendance,
  completionRate,
  examPassRate,
} from "@/lib/academia/kpis";
import { computeBankBalances } from "@/lib/banks/balance";
import { computeHealthScore } from "@/lib/clients/health";
import type {
  NpsResponseRow,
  ProjectHealthRow,
  TicketRow,
} from "@/lib/clients/types";
import { bucketOfCategory } from "@/lib/finance/expense-categories";
import { fCount, fMoney } from "@/lib/finance/format";
import type { Ownership } from "@/lib/finance/invoice-classification";
import {
  clientBalance,
  computeAccountsPayable,
  computeAccountsReceivable,
  computeBurnRate,
  computeCashFlow,
  computeProfit,
  sumExpensesNet,
  sumPayrollTotal,
} from "@/lib/finance/kpis";
import { loadLatestOrgFxRate, loadOrgFxRatesByMonth } from "@/lib/money";
import {
  inPeriodDate,
  inPeriodTs,
  lastClosedMonths,
  lastMonths,
  overlapsPeriodDate,
  resolvePeriod,
} from "@/lib/finance/period";
import { computeRevenue, type OwnershipResolver } from "@/lib/finance/revenue";
import { classifyRunway } from "@/lib/finance/runway";
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
import { requireRole } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

import { RangePills, type PresetOption } from "./financiero/range-pills";

export const metadata: Metadata = { title: "Ejecutivo" };

// Snapshot vivo del negocio. Fetch en cada request — no vale la pena
// cachear porque el volumen es bajo y los datos cambian con cada
// operación (cobros, gastos, tickets, etc.).
export const dynamic = "force-dynamic";

// ═══════════════════════════════════════════════════════════════════════════
// Dashboard Ejecutivo.
//
// Regla del bloque: NO calcula nada propio. Consume los selectores puros
// de src/lib/{finance,clients,academia,ops}. Si un número falta, se
// agrega al selector del módulo dueño, nunca acá.
//
// Motor de alertas: postergado. Las alertas mostradas acá son derivables
// directamente de datos existentes (bloqueadores viejos, tareas
// vencidas, clientes con health bajo, exámenes pendientes). Un motor
// con umbrales configurables + tabla executive_alerts es proyecto
// aparte cuando aparezca la necesidad.
// ═══════════════════════════════════════════════════════════════════════════

const RANGE_PRESETS: readonly PresetOption[] = [
  { value: "mes-actual", label: "Mes actual" },
  { value: "mes-anterior", label: "Mes anterior" },
  { value: "90d", label: "90D" },
];

const ROLES_WITH_ACCESS = ["superadmin", "admin"] as const;

type OwnershipVal = "propia" | "externa";

interface ProjectOwnershipRow {
  readonly id: string;
  readonly name: string | null;
  readonly ownership: OwnershipVal;
}

interface ClientRowLite {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
}

interface CohortRow {
  readonly id: string;
  readonly name: string;
  readonly project_id: string;
  readonly course_id: string | null;
  readonly status: "planned" | "active" | "finished" | "cancelled";
  readonly start_date: string;
  readonly end_date: string;
}

interface ClassRow {
  readonly id: string;
  readonly cohort_id: string;
}

interface AttendanceRow {
  readonly class_id: string;
  readonly present: boolean;
}

interface EnrollmentRow {
  readonly cohort_id: string;
  readonly student_id: string;
  readonly status: "active" | "completed" | "dropped" | "suspended";
}

interface StudentRow {
  readonly id: string;
  readonly status: "active" | "inactive" | "graduated";
}

interface ExamRow {
  readonly cohort_id: string;
  readonly passed: boolean | null;
}

interface CertificateRowLite {
  readonly student_id: string;
}

interface InternalProjectRow {
  readonly status: "backlog" | "active" | "paused" | "done" | "archived";
}

interface TaskRow {
  readonly id: string;
  readonly status: "todo" | "doing" | "blocked" | "done" | "cancelled";
  readonly assignee_id: string | null;
  readonly due_on: string | null;
}

interface BlockerRow {
  readonly id: string;
  readonly reason: string;
  readonly opened_at: string;
  readonly resolved_at: string | null;
}

interface ClientRiskRow {
  readonly clientId: string;
  readonly name: string;
  readonly score: number;
  readonly relationshipStatus: string;
  readonly isManual: boolean;
}

const OPEN_INTERNAL_STATUSES = new Set<InternalProjectRow["status"]>([
  "backlog",
  "active",
  "paused",
]);

const OPEN_TASK_STATUSES = new Set<TaskRow["status"]>([
  "todo",
  "doing",
  "blocked",
]);

const COHORT_LABEL = {
  planned: "Planeada",
  active: "Activa",
  finished: "Terminada",
  cancelled: "Cancelada",
} as const;

const COHORT_TONE = {
  planned: "var(--kg-neutral-500)",
  active: "var(--kg-positive-500)",
  finished: "var(--kg-accent-500)",
  cancelled: "var(--kg-negative-500)",
} as const;

export default async function EjecutivoDashboardPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Gate de rol: dev pasa por bypass interno; los demás roles válidos son
  // explícitos. Coordinador/operador/cliente son redirigidos por requireRole:
  // coordinador → "/" (que a su vez lo bota — evitamos ciclo pasando por el
  // gate anterior de layouts), operador → /operaciones, cliente → /lanzamientos.
  await requireRole(...ROLES_WITH_ACCESS);

  const sp = await searchParams;
  const rangeParam = firstParam(sp.range);
  const fromParam = firstParam(sp.from);
  const toParam = firstParam(sp.to);
  const isCustom = fromParam != null && toParam != null;
  const period = resolvePeriod({
    range: rangeParam,
    from: fromParam,
    to: toParam,
  });

  const supabase = await createClient();

  // ─── Batch 1: finanzas + estado org ──────────────────────────────────
  const [
    projectsRes,
    banksRes,
    bankMovementsRes,
    expensesRes,
    payrollRes,
    invoicesRes,
    assetsRes,
    liabilitiesRes,
    clientTransfersRes,
    settlementsRes,
    payoutsRes,
    latestFx,
    orgFxByMonth,
  ] = await Promise.all([
    supabase.from("projects").select("id, name, ownership"),
    supabase
      .from("banks")
      .select("id, balance, opening_balance, currency, active"),
    supabase
      .from("bank_movements")
      .select("bank_id, amount, kind, occurred_at"),
    supabase
      .from("expenses")
      .select(
        "amount_gross, tax_amount, currency, category, paid_at, due_date, expense_date, project_id",
      ),
    supabase
      .from("payroll")
      .select(
        "total_amount, currency, paid_at, due_date, period_start, period_end",
      ),
    supabase
      .from("invoices")
      .select(
        "project_id, launch_id, amount_gross, tax_amount, currency, status, paid_at, due_date, issue_date",
      ),
    supabase.from("assets").select("amount, active"),
    supabase.from("liabilities").select("amount, active, settled_at"),
    supabase.from("client_transfers").select("amount, direction, date"),
    supabase
      .from("launch_settlements")
      .select("kingrow_retained, status, closed_at, created_at, project_id, launch_id"),
    // Comisiones al equipo del período — cost directo del launch. Se filtra
    // por launch después de resolver la tasa; acá traemos el período crudo.
    supabase
      .from("team_member_payouts")
      .select("launch_id, amount, paid_at")
      .gte("paid_at", period.fromYmd)
      .lte("paid_at", period.toYmd),
    loadLatestOrgFxRate(supabase),
    loadOrgFxRatesByMonth(supabase),
  ]);

  const projects =
    (projectsRes.data ?? []) as unknown as ProjectOwnershipRow[];
  const ownershipByProject = new Map<string, OwnershipVal>();
  for (const p of projects) ownershipByProject.set(p.id, p.ownership);
  const resolveOwnership: OwnershipResolver = (projectId) =>
    (projectId ? ownershipByProject.get(projectId) : undefined) as Ownership;

  const banks =
    (banksRes.data ?? []) as unknown as ReadonlyArray<{
      id: string;
      balance: number;
      opening_balance: number;
      currency: "ARS" | "USD";
      active: boolean;
    }>;
  const bankMovements =
    (bankMovementsRes.data ?? []) as unknown as (FinanceBankMovementRow & {
      bank_id: string;
    })[];
  const allExpenses =
    (expensesRes.data ?? []) as unknown as FinanceExpenseRow[];
  const allPayroll =
    (payrollRes.data ?? []) as unknown as FinancePayrollRow[];
  const allInvoices =
    (invoicesRes.data ?? []) as unknown as FinanceInvoiceRow[];
  const assets = (assetsRes.data ?? []) as unknown as FinanceAssetRow[];
  const liabilities =
    (liabilitiesRes.data ?? []) as unknown as FinanceLiabilityRow[];
  const allClientTransfers =
    (clientTransfersRes.data ?? []) as unknown as FinanceClientTransferRow[];
  const allSettlements =
    (settlementsRes.data ?? []) as unknown as (FinanceLaunchSettlementRow & {
      project_id: string;
      launch_id: string;
    })[];
  const payouts = (payoutsRes.data ?? []) as unknown as ReadonlyArray<{
    readonly launch_id: string;
    readonly amount: number;
    readonly paid_at: string;
  }>;

  // ─── FX helpers (mismo patrón que /financiero) ───────────────────────
  // Para expenses/payroll usamos tasa org por mes con fallback a la más
  // reciente. Payouts se convierten con la tasa del launch (si null → USD
  // nativo). Invoices y settlements piden lookup por launch — pero acá el
  // exec no carga launches individuales, así que usamos la tasa org como
  // fallback global; para invoices, la tasa mensual del proyecto si existe.
  const orgLatestRate =
    latestFx && latestFx.rate > 0 ? latestFx.rate : null;
  function resolveOrgRateForMonth(ymd: string | null | undefined): number | null {
    if (ymd == null) return orgLatestRate;
    const m = orgFxByMonth.get(ymd.slice(0, 7));
    if (m != null && m > 0) return m;
    return orgLatestRate;
  }
  function expenseToUsd(amount: number, e: FinanceExpenseRow): number {
    if (e.currency === "USD") return amount;
    const rate = resolveOrgRateForMonth(e.expense_date);
    return rate != null ? amount / rate : amount;
  }
  function payrollToUsd(amount: number, p: FinancePayrollRow): number {
    if (p.currency === "USD") return amount;
    const rate = resolveOrgRateForMonth(p.period_start);
    return rate != null ? amount / rate : amount;
  }
  function invoiceToUsd(amount: number, i: FinanceInvoiceRow): number {
    if (i.currency === "USD") return amount;
    const rate = resolveOrgRateForMonth(i.paid_at ?? i.issue_date);
    return rate != null ? amount / rate : amount;
  }

  // Cargo launches para todos los launch_ids referenciados por settlements
  // y payouts. Necesito `ars_per_usd` para convertir kingrow_retained y
  // comisiones — un launch USD-native (rate=null) no debe convertirse; si
  // es ARS, se divide por la tasa. RLS de launches es project-scope; si
  // deniega, el fallback es tasa org (imperfecto pero no rompe).
  const launchIdSet = new Set<string>();
  for (const s of allSettlements) launchIdSet.add(s.launch_id);
  for (const p of payouts) launchIdSet.add(p.launch_id);
  const launchArsPerUsd = new Map<string, number | null>();
  if (launchIdSet.size > 0) {
    const launchesRes = await supabase
      .from("launches")
      .select("id, ars_per_usd")
      .in("id", Array.from(launchIdSet));
    const rows = (launchesRes.data ?? []) as unknown as ReadonlyArray<{
      readonly id: string;
      readonly ars_per_usd: number | null;
    }>;
    for (const l of rows) launchArsPerUsd.set(l.id, l.ars_per_usd);
  }
  function launchToUsd(amount: number, launchId: string): number {
    // Prioridad: tasa del launch (si ARS-nativo). Si el launch es USD
    // (rate=null) o no lo pudimos leer, cae a la tasa org del mes actual.
    const rate = launchArsPerUsd.get(launchId);
    if (rate != null && rate > 0) return amount / rate;
    if (rate === null) return amount; // launch USD-nativo explícito
    // Sin info del launch → fallback org (mejor que romper)
    return orgLatestRate != null ? amount / orgLatestRate : amount;
  }

  // Filtrar al período seleccionado.
  const expensesInPeriod = allExpenses.filter((e) =>
    inPeriodDate(e.expense_date, period),
  );
  const payrollInPeriod = allPayroll.filter((p) =>
    overlapsPeriodDate(p.period_start, p.period_end, period),
  );
  const bankMovementsInPeriod = bankMovements.filter((m) =>
    inPeriodTs(m.occurred_at, period),
  );
  const settlementsInPeriod = allSettlements.filter((s) =>
    inPeriodTs(s.closed_at, period),
  );
  const invoicesCollectedInPeriod = allInvoices.filter(
    (i) => i.status === "cobrada" && inPeriodTs(i.paid_at, period),
  );

  // ─── Conversión a USD para el P&L ────────────────────────────────────
  // Mismo racional que en /financiero: revenue + expenses + payroll +
  // payouts convertidos con las tasas cargadas. Fallback a la tasa org
  // más reciente cuando no hay tasa específica del mes/launch.
  const settlementsUsd = settlementsInPeriod.map((s) => ({
    ...s,
    kingrow_retained: launchToUsd(s.kingrow_retained, s.launch_id),
  }));
  const invoicesCollectedInPeriodUsd = invoicesCollectedInPeriod.map((i) => ({
    ...i,
    amount_gross: invoiceToUsd(i.amount_gross, i),
    tax_amount: invoiceToUsd(i.tax_amount, i),
  }));

  // Revenue Kingrow del período. Regla: para propias el ingreso ya sumó
  // por invoice cobrada, así que descartamos sus liquidaciones para no
  // contar dos veces. Solo cuentan las settlements de projects externos.
  const settlementsForRevenue = settlementsUsd.filter(
    (s) => ownershipByProject.get(s.project_id) !== "propia",
  );
  const revenue = computeRevenue({
    settlements: settlementsForRevenue,
    invoices: invoicesCollectedInPeriodUsd,
    resolveOwnership,
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Tendencia de ingreso — últimos 12 meses cronológicos. Mismo pooling que
  // /financiero (revenueBuckets): itera sobre las arrays completas, no las
  // *InPeriod, para tener todos los buckets. Convertimos row-a-row a USD
  // dentro de cada bucket con los helpers ya definidos (mismo criterio de
  // ownership que la sección del período).
  // ═════════════════════════════════════════════════════════════════════════
  const revenueBuckets = lastMonths(12).map((b) => {
    const settlementsBucket = allSettlements
      .filter((s) => inPeriodTs(s.closed_at, b))
      .filter((s) => ownershipByProject.get(s.project_id) !== "propia")
      .map((s) => ({
        ...s,
        kingrow_retained: launchToUsd(s.kingrow_retained, s.launch_id),
      }));
    const invoicesBucket = allInvoices
      .filter((i) => i.status === "cobrada" && inPeriodTs(i.paid_at, b))
      .map((i) => ({
        ...i,
        amount_gross: invoiceToUsd(i.amount_gross, i),
        tax_amount: invoiceToUsd(i.tax_amount, i),
      }));
    const rev = computeRevenue({
      settlements: settlementsBucket,
      invoices: invoicesBucket,
      resolveOwnership,
    });
    return { key: b.key, label: b.label, revenue: rev.revenueTotal };
  });

  // Delta MoM: último mes cerrado vs anterior. Mismo criterio que
  // /financiero (compara meses completos, no el en-curso).
  let revenueDelta: { pct: number; dir: "up" | "down" } | null = null;
  if (revenueBuckets.length >= 3) {
    const lastFull = revenueBuckets[revenueBuckets.length - 2];
    const prevFull = revenueBuckets[revenueBuckets.length - 3];
    if (lastFull && prevFull && prevFull.revenue > 0) {
      const pct = (lastFull.revenue - prevFull.revenue) / prevFull.revenue;
      revenueDelta = { pct: Math.abs(pct), dir: pct >= 0 ? "up" : "down" };
    }
  }

  // Egresos convertidos a USD y separados en 3 buckets (direct / tax /
  // operating) por category, mismo criterio que /financiero. Payouts al
  // equipo suman como costo directo del launch.
  const expensesInPeriodUsd = expensesInPeriod.map((e) => ({
    ...e,
    amount_gross: expenseToUsd(e.amount_gross, e),
    tax_amount: expenseToUsd(e.tax_amount, e),
  }));
  const payrollInPeriodUsd = payrollInPeriod.map((p) => ({
    ...p,
    total_amount: payrollToUsd(p.total_amount, p),
  }));
  const expensesByBucket = { direct: 0, tax: 0, operating: 0 };
  for (const e of expensesInPeriodUsd) {
    const bucket = bucketOfCategory(e.category);
    expensesByBucket[bucket] += e.amount_gross - e.tax_amount;
  }
  const payoutsUsdTotal = payouts.reduce(
    (acc, p) => acc + launchToUsd(p.amount, p.launch_id),
    0,
  );
  const expensesNet = sumExpensesNet(expensesInPeriodUsd);
  const payrollTotal = sumPayrollTotal(payrollInPeriodUsd);
  const profit = computeProfit({
    revenue: revenue.revenueTotal,
    directCosts: expensesByBucket.direct + payoutsUsdTotal,
    operatingExpenses: expensesByBucket.operating,
    payroll: payrollTotal,
    taxes: expensesByBucket.tax,
  });

  // Caja consolidada en USD. Sumo saldo por banco activo separando por
  // moneda; los ARS se convierten con la tasa org más reciente. Si hay
  // saldo ARS y no hay tasa, `bankBalanceTotalUsd` queda null y el runway
  // muestra "—" con hint.
  const activeBanks = banks.filter((b) => b.active);
  const bankBalancesMap = computeBankBalances(
    activeBanks as never,
    bankMovements.map((m) => ({
      bank_id: m.bank_id,
      amount: m.amount,
      kind: m.kind,
    })),
  );
  let bankBalanceArsNative = 0;
  let bankBalanceUsdNative = 0;
  for (const b of activeBanks) {
    const bal = bankBalancesMap.get(b.id);
    const total = bal?.total ?? Number(b.opening_balance);
    if (b.currency === "USD") bankBalanceUsdNative += total;
    else bankBalanceArsNative += total;
  }
  let bankBalanceTotalUsd: number | null;
  if (bankBalanceArsNative === 0) {
    bankBalanceTotalUsd = bankBalanceUsdNative;
  } else if (orgLatestRate != null) {
    bankBalanceTotalUsd =
      bankBalanceUsdNative + bankBalanceArsNative / orgLatestRate;
  } else {
    bankBalanceTotalUsd = null;
  }
  // ─── Conversión de invoices/transfers a USD para AR/AP consolidados ─
  // Mismos criterios que /financiero: invoices por currency + fx del mes
  // del proyecto (fallback org); client_transfers por tasa org del mes
  // (aproximación — no tienen currency propia).
  const allInvoicesUsd = allInvoices.map((i) => ({
    ...i,
    amount_gross: invoiceToUsd(i.amount_gross, i),
    tax_amount: invoiceToUsd(i.tax_amount, i),
  }));
  const allClientTransfersUsd = allClientTransfers.map((t) => ({
    ...t,
    amount: resolveOrgRateForMonth(t.date)
      ? t.amount / (resolveOrgRateForMonth(t.date) as number)
      : t.amount,
  }));

  // AR de Kingrow. `favorKingrowBalance` es positivo cuando algún cliente
  // le debe a Kingrow (clientBalance negativo). Todo en USD.
  const rawClientBalance = clientBalance(allClientTransfersUsd);
  const favorKingrowBalance = Math.max(0, -rawClientBalance);
  const ar = computeAccountsReceivable({
    invoices: allInvoicesUsd,
    resolveOwnership,
    favorKingrowBalance,
  });

  // Burn + runway. Burn: TODOS los costos que restan a utilidad neta
  // (gastos + payroll + payouts) sobre los últimos 3 meses cerrados —
  // ventana FIJA independiente del ?range. Runway: caja de bancos USD ÷
  // burn mensual. Reemplaza el snapshot manual de assets — la caja es
  // derivada en vivo.
  const burnWindow = lastClosedMonths(3);
  const burnExpenses = allExpenses
    .map((e) => ({
      ...e,
      amount_gross: expenseToUsd(e.amount_gross, e),
      tax_amount: expenseToUsd(e.tax_amount, e),
    }))
    .filter((e) => inPeriodDate(e.expense_date, burnWindow));
  const burnPayroll = allPayroll
    .map((p) => ({ ...p, total_amount: payrollToUsd(p.total_amount, p) }))
    .filter((p) =>
      overlapsPeriodDate(p.period_start, p.period_end, burnWindow),
    );
  const burnPayoutsUsd = payouts
    .filter((p) => inPeriodDate(p.paid_at, burnWindow))
    .reduce((acc, p) => acc + launchToUsd(p.amount, p.launch_id), 0);
  const burnRate = computeBurnRate({
    expenses: burnExpenses,
    payroll: burnPayroll,
    monthsInWindow: burnWindow.monthsInWindow,
    otherCosts: burnPayoutsUsd,
  });
  const runwayClass = classifyRunway({
    cashOnHand: bankBalanceTotalUsd,
    monthlyBurn: burnRate,
    snapshotStale: false,
  });

  // Cash flow real del período en USD. Cada movimiento hereda la moneda
  // de su banco (banks.currency). Los cobros de ventas ya están en
  // bank_movements como 'in' cuando entran al banco — sumar `payments`
  // aparte sería doble conteo.
  const bankCurrencyById = new Map<string, "ARS" | "USD">();
  for (const b of banks) bankCurrencyById.set(b.id, b.currency);
  const bankMovementsInPeriodUsd = bankMovementsInPeriod.map((m) => {
    const currency = bankCurrencyById.get(m.bank_id) ?? "ARS";
    if (currency === "USD") return m;
    const rate = resolveOrgRateForMonth(m.occurred_at);
    return { ...m, amount: rate != null ? m.amount / rate : m.amount };
  });
  const cashFlow = computeCashFlow({
    bankMovements: bankMovementsInPeriodUsd,
  });

  // ─── Batch 2: clientes + academia + ops ─────────────────────────────
  const [
    clientsRes,
    projectHealthRes,
    npsRes,
    ticketsRes,
    cohortsRes,
    classesRes,
    attendanceRes,
    enrollmentsRes,
    studentsRes,
    examsRes,
    certificatesRes,
    internalProjectsRes,
    tasksRes,
    blockersRes,
  ] = await Promise.all([
    supabase.from("clients").select("id, name, active"),
    supabase
      .from("project_health")
      .select(
        "client_id, organization_id, relationship_status, health_score, last_contact_at",
      ),
    supabase
      .from("nps_responses")
      .select("client_id, score, responded_at"),
    supabase
      .from("tickets")
      .select(
        "client_id, project_id, status, priority, created_at, resolved_at",
      ),
    supabase
      .from("cohorts")
      .select(
        "id, name, project_id, course_id, status, start_date, end_date",
      ),
    supabase.from("classes").select("id, cohort_id"),
    supabase.from("attendance").select("class_id, present"),
    supabase.from("enrollments").select("cohort_id, student_id, status"),
    supabase.from("students").select("id, status"),
    supabase.from("exams").select("cohort_id, passed"),
    supabase.from("certificates").select("student_id"),
    supabase.from("internal_projects").select("status"),
    supabase.from("tasks").select("id, status, assignee_id, due_on"),
    supabase
      .from("blockers")
      .select("id, reason, opened_at, resolved_at")
      .is("resolved_at", null),
  ]);

  const clients = (clientsRes.data ?? []) as unknown as ClientRowLite[];
  const projectHealthRows =
    (projectHealthRes.data ?? []) as unknown as ProjectHealthRow[];
  const npsRows = (npsRes.data ?? []) as unknown as NpsResponseRow[];
  const ticketRows = (ticketsRes.data ?? []) as unknown as TicketRow[];
  const cohorts = (cohortsRes.data ?? []) as unknown as CohortRow[];
  const classes = (classesRes.data ?? []) as unknown as ClassRow[];
  const attendance =
    (attendanceRes.data ?? []) as unknown as AttendanceRow[];
  const enrollments =
    (enrollmentsRes.data ?? []) as unknown as EnrollmentRow[];
  const students = (studentsRes.data ?? []) as unknown as StudentRow[];
  const exams = (examsRes.data ?? []) as unknown as ExamRow[];
  const certificates =
    (certificatesRes.data ?? []) as unknown as CertificateRowLite[];
  const internalProjects =
    (internalProjectsRes.data ?? []) as unknown as InternalProjectRow[];
  const tasks = (tasksRes.data ?? []) as unknown as TaskRow[];
  const blockers = (blockersRes.data ?? []) as unknown as BlockerRow[];

  // ─── AP (después de tener client_transfers + payroll + expenses) ────
  // Todo consolidado en USD para ser coherente con AR/utilidad/bancos.
  const allExpensesUsd = allExpenses.map((e) => ({
    ...e,
    amount_gross: expenseToUsd(e.amount_gross, e),
    tax_amount: expenseToUsd(e.tax_amount, e),
  }));
  const allPayrollUsd = allPayroll.map((p) => ({
    ...p,
    total_amount: payrollToUsd(p.total_amount, p),
  }));
  const ap = computeAccountsPayable({
    expenses: allExpensesUsd,
    payroll: allPayrollUsd,
    clientTransfers: allClientTransfersUsd,
  });

  // ─── Salud de clientes (top 5 en riesgo) ────────────────────────────
  const healthByClient = new Map<string, ProjectHealthRow>();
  for (const h of projectHealthRows) healthByClient.set(h.client_id, h);
  const npsByClient = new Map<string, NpsResponseRow[]>();
  for (const n of npsRows) {
    const bucket = npsByClient.get(n.client_id) ?? [];
    bucket.push(n);
    npsByClient.set(n.client_id, bucket);
  }
  const ticketsByClient = new Map<string, TicketRow[]>();
  for (const t of ticketRows) {
    const bucket = ticketsByClient.get(t.client_id) ?? [];
    bucket.push(t);
    ticketsByClient.set(t.client_id, bucket);
  }

  const activeClients = clients.filter((c) => c.active);
  const clientRisks: ClientRiskRow[] = activeClients.map((c) => {
    const health = healthByClient.get(c.id) ?? null;
    const clientNps = npsByClient.get(c.id) ?? [];
    const clientTickets = ticketsByClient.get(c.id) ?? [];
    // Política: override manual gana; sino usa el computado.
    let score: number;
    let isManual = false;
    if (health?.health_score != null) {
      score = health.health_score;
      isManual = true;
    } else {
      const breakdown = computeHealthScore({
        nps: clientNps,
        tickets: clientTickets,
        lastContactAt: health?.last_contact_at ?? null,
      });
      score = breakdown.score;
    }
    return {
      clientId: c.id,
      name: c.name,
      score,
      relationshipStatus: health?.relationship_status ?? "sin registrar",
      isManual,
    };
  });

  const avgHealth =
    clientRisks.length === 0
      ? null
      : clientRisks.reduce((n, c) => n + c.score, 0) / clientRisks.length;

  const clientsAtRisk = [...clientRisks]
    .sort((a, b) => a.score - b.score)
    .slice(0, 5);

  // ─── Academia ────────────────────────────────────────────────────────
  const activeStudentsCount = computeActiveStudents(students);
  const activeCohortsCount = cohorts.filter((c) => c.status === "active")
    .length;
  const overallCompletion = completionRate(enrollments);
  const overallAttendance = averageAttendance(attendance);
  const overallPassRate = examPassRate(exams);
  const pendingExamsCount = exams.filter((e) => e.passed === null).length;
  const certifiedStudents = new Set(certificates.map((c) => c.student_id))
    .size;

  // Cohortes en curso (max 5) — active > planned, dentro de cada uno
  // start_date desc.
  const cohortsInProgress = cohorts
    .filter((c) => c.status === "active" || c.status === "planned")
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "active" ? -1 : 1;
      return b.start_date.localeCompare(a.start_date);
    })
    .slice(0, 5);

  const classToCohort = new Map<string, string>();
  for (const c of classes) classToCohort.set(c.id, c.cohort_id);
  const attendanceByCohort = new Map<string, AttendanceRow[]>();
  for (const a of attendance) {
    const cid = classToCohort.get(a.class_id);
    if (!cid) continue;
    const bucket = attendanceByCohort.get(cid) ?? [];
    bucket.push(a);
    attendanceByCohort.set(cid, bucket);
  }
  const enrollmentsByCohort = new Map<string, EnrollmentRow[]>();
  for (const e of enrollments) {
    const bucket = enrollmentsByCohort.get(e.cohort_id) ?? [];
    bucket.push(e);
    enrollmentsByCohort.set(e.cohort_id, bucket);
  }

  // ─── Ops ─────────────────────────────────────────────────────────────
  const openInternalProjects = internalProjects.filter((p) =>
    OPEN_INTERNAL_STATUSES.has(p.status),
  ).length;
  const openTasks = tasks.filter((t) => OPEN_TASK_STATUSES.has(t.status));
  const today = todayYmd();
  const overdueTasks = openTasks.filter(
    (t) => t.due_on != null && t.due_on < today,
  );
  const unassignedOpen = openTasks.filter((t) => t.assignee_id == null).length;
  const nowMs = Date.now();
  const oldBlockers = blockers.filter((b) => {
    const openedMs = new Date(b.opened_at).getTime();
    return (nowMs - openedMs) / 86_400_000 >= 7;
  });

  // ─── Header tone helpers ─────────────────────────────────────────────
  const runwayMonths = runwayClass.months;
  const runwayLabel =
    runwayMonths == null ? "—" : `${runwayMonths.toFixed(1)} m`;
  const runwayColor =
    runwayMonths == null
      ? undefined
      : runwayMonths < 3
        ? "#F04060"
        : runwayMonths < 6
          ? "#FFB800"
          : undefined;

  const rangePillsPreset =
    isCustom || period.key === "custom" ? null : period.key;
  const rangePillsFrom = isCustom ? period.fromYmd : null;
  const rangePillsTo = isCustom ? period.toYmd : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconExec size={16} />}
        title="Ejecutivo"
        stats={[
          {
            l: `Ingreso (${period.label})`,
            v: fMoney(revenue.revenueTotal),
          },
          {
            l: `Utilidad neta (${period.label})`,
            v: fMoney(profit.netProfit),
            c: profit.netProfit < 0 ? "#F04060" : undefined,
          },
          {
            l: "Caja",
            v: bankBalanceTotalUsd == null ? "—" : fMoney(bankBalanceTotalUsd),
          },
          { l: "Runway", v: runwayLabel, c: runwayColor },
          {
            l: "Salud clientes prom.",
            v: avgHealth == null ? "—" : `${Math.round(avgHealth)}/100`,
            c:
              avgHealth != null && avgHealth < 50
                ? "#F04060"
                : avgHealth != null && avgHealth < 70
                  ? "#FFB800"
                  : undefined,
          },
        ]}
      />

      <RangePills
        presets={RANGE_PRESETS}
        activePreset={rangePillsPreset}
        activeFrom={rangePillsFrom}
        activeTo={rangePillsTo}
        baseHref="/"
      />

      {/* Grid principal de KPI cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 16,
        }}
      >
        <KpiCard
          label={`Ingreso Kingrow (${period.label})`}
          value={fMoney(revenue.revenueTotal)}
          hint={
            revenue.revenueTotal === 0
              ? "Sin ingresos en el período"
              : `${fMoney(revenue.revenueFromSettlements)} liquidaciones + ${fMoney(revenue.revenueFromDirectSales)} facturas directas`
          }
        />
        <KpiCard
          label="Utilidad neta"
          value={fMoney(profit.netProfit)}
          hint={
            profit.netMargin == null
              ? "Sin ingresos"
              : `Margen ${Math.round(profit.netMargin * 100)}%`
          }
          tone={profit.netProfit < 0 ? "negative" : undefined}
        />
        <KpiCard
          label="AR Kingrow"
          value={fMoney(ar.totalReceivable)}
          hint={
            ar.invoicesCount === 0 && ar.favorKingrowBalance === 0
              ? "Sin cuentas por cobrar"
              : `${ar.invoicesCount} facturas + ${fMoney(ar.favorKingrowBalance)} a favor`
          }
        />
        <KpiCard
          label="AP Kingrow"
          value={fMoney(ap.totalPayable)}
          hint={
            ap.totalPayable === 0
              ? "Sin cuentas por pagar"
              : `${fMoney(ap.expensesPayableNet)} gastos + ${fMoney(ap.payrollPayable)} nómina + ${fMoney(ap.clientPayable)} a clientes`
          }
        />
        <KpiCard
          label="Clientes activos"
          value={fCount(activeClients.length)}
          hint={
            avgHealth == null
              ? "Sin health calculada"
              : `Health prom ${Math.round(avgHealth)}/100`
          }
        />
        <KpiCard
          label="Generaciones activas"
          value={fCount(activeCohortsCount)}
          hint={`${fCount(activeStudentsCount)} estudiantes activos · ${certifiedStudents}/${students.length} certificados`}
        />
        <KpiCard
          label="Aprobación / Asistencia"
          value={formatPct(overallPassRate)}
          hint={
            overallAttendance == null
              ? "Sin asistencias registradas"
              : `Asistencia ${formatPct(overallAttendance)}${
                  overallCompletion != null
                    ? ` · Finalización ${formatPct(overallCompletion)}`
                    : ""
                }`
          }
        />
        <KpiCard
          label="Ops abiertas"
          value={fCount(openTasks.length)}
          hint={`${openInternalProjects} proyectos abiertos · ${overdueTasks.length} vencidas`}
          tone={overdueTasks.length > 0 ? "warning" : undefined}
        />
      </div>

      {/* Tendencia de ingreso — 12 meses cronológicos */}
      <Panel title="Tendencia de ingreso (12 meses, USD)">
        <RevenueTrend
          buckets={revenueBuckets}
          delta={revenueDelta}
          periodLabel={period.label}
        />
      </Panel>

      {/* Alertas cruzadas */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
          gap: 16,
        }}
      >
        <Panel title="Clientes en riesgo">
          {clientsAtRisk.length === 0 ? (
            <EmptyState
              title="Sin clientes activos"
              hint="Cuando cargues clientes en /clientes van a aparecer acá los de menor health score."
            />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {clientsAtRisk.map((c) => {
                const tone =
                  c.score < 40
                    ? "var(--kg-negative-500)"
                    : c.score < 70
                      ? "var(--kg-warning-500)"
                      : "var(--kg-positive-500)";
                return (
                  <Link
                    key={c.clientId}
                    href={`/clientes/${c.clientId}`}
                    className="kg-focus"
                    style={{
                      padding: "10px 14px",
                      borderRadius: "var(--kg-r-8)",
                      background: "var(--kg-surface-2-solid)",
                      border: "1px solid var(--kg-border-subtle)",
                      display: "grid",
                      gridTemplateColumns: "1fr auto",
                      gap: 12,
                      alignItems: "center",
                      textDecoration: "none",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          color: "var(--kg-text-1)",
                          fontSize: 13,
                          fontWeight: 600,
                        }}
                      >
                        {c.name}
                      </div>
                      <div
                        className="kg-t7"
                        style={{
                          color: "var(--kg-text-3)",
                          marginTop: 2,
                          display: "flex",
                          gap: 6,
                          alignItems: "center",
                        }}
                      >
                        <span>{c.relationshipStatus}</span>
                        {c.isManual && (
                          <span
                            style={{
                              padding: "0 6px",
                              borderRadius: 4,
                              background: "var(--kg-surface-1-solid)",
                              color: "var(--kg-text-3)",
                              fontSize: 10,
                              fontWeight: 700,
                            }}
                            title="Health score con override manual"
                          >
                            Manual
                          </span>
                        )}
                      </div>
                    </div>
                    <StatusPill
                      text={`${Math.round(c.score)}/100`}
                      tone={tone}
                    />
                  </Link>
                );
              })}
              <Link
                href="/clientes"
                className="kg-focus"
                style={{
                  color: "var(--kg-accent-text)",
                  fontSize: 11,
                  fontWeight: 700,
                  textDecoration: "none",
                  padding: "6px 2px 0",
                }}
              >
                Ver todos ({activeClients.length}) →
              </Link>
            </div>
          )}
        </Panel>

        <Panel title="Ops crítico">
          {oldBlockers.length === 0 &&
          overdueTasks.length === 0 &&
          unassignedOpen === 0 &&
          pendingExamsCount === 0 ? (
            <EmptyState
              title="Sin ops crítico"
              hint="Nada urgente hoy: no hay bloqueadores viejos, tareas vencidas ni exámenes sin corregir."
            />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {oldBlockers.length > 0 && (
                <AlertRow
                  href="/operaciones/bloqueadores"
                  label={`${oldBlockers.length} bloqueador${oldBlockers.length === 1 ? "" : "es"} con 7d+ sin resolver`}
                  tone="critical"
                />
              )}
              {overdueTasks.length > 0 && (
                <AlertRow
                  href="/operaciones/tareas"
                  label={`${overdueTasks.length} tarea${overdueTasks.length === 1 ? "" : "s"} vencida${overdueTasks.length === 1 ? "" : "s"}`}
                  tone="critical"
                />
              )}
              {unassignedOpen > 0 && (
                <AlertRow
                  href="/operaciones/tareas"
                  label={`${unassignedOpen} tarea${unassignedOpen === 1 ? "" : "s"} sin asignar`}
                  tone="warning"
                />
              )}
              {pendingExamsCount > 0 && (
                <AlertRow
                  href="/academia/cohortes"
                  label={`${pendingExamsCount} examen${pendingExamsCount === 1 ? "" : "es"} pendiente${pendingExamsCount === 1 ? "" : "s"} de corrección`}
                  tone="warning"
                />
              )}
            </div>
          )}
        </Panel>
      </div>

      {/* Cohortes en curso — solo si hay */}
      {cohortsInProgress.length > 0 && (
        <Panel title="Generaciones en curso">
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 12,
            }}
          >
            <thead>
              <tr>
                <th style={thStyle}>Generación</th>
                <th style={thStyle}>Estado</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Inscriptos</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Asistencia</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Aprobación</th>
              </tr>
            </thead>
            <tbody>
              {cohortsInProgress.map((c) => {
                const cohortEnr = enrollmentsByCohort.get(c.id) ?? [];
                const cohortAtt = attendanceByCohort.get(c.id) ?? [];
                const cohortExs = exams.filter((e) => e.cohort_id === c.id);
                const att = averageAttendance(cohortAtt);
                const pass = examPassRate(cohortExs);
                return (
                  <tr
                    key={c.id}
                    style={{
                      borderTop: "1px solid var(--kg-border-subtle)",
                    }}
                  >
                    <td
                      style={{
                        ...tdStyle,
                        color: "var(--kg-text-1)",
                        fontWeight: 600,
                      }}
                    >
                      <Link
                        href={`/academia/cohortes/${c.id}`}
                        className="kg-focus"
                        style={{
                          color: "inherit",
                          textDecoration: "none",
                        }}
                      >
                        {c.name}
                      </Link>
                    </td>
                    <td style={tdStyle}>
                      <StatusPill
                        text={COHORT_LABEL[c.status]}
                        tone={COHORT_TONE[c.status]}
                      />
                    </td>
                    <td style={{ ...tdStyle, ...numStyle }}>
                      {cohortEnr.length === 0 ? (
                        <span style={{ color: "var(--kg-text-3)" }}>—</span>
                      ) : (
                        cohortEnr.length
                      )}
                    </td>
                    <td style={{ ...tdStyle, ...numStyle }}>
                      {formatPct(att)}
                    </td>
                    <td style={{ ...tdStyle, ...numStyle }}>
                      {formatPct(pass)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      )}

      {/* Contexto cashflow del período */}
      <div
        className="kg-t7"
        style={{
          color: "var(--kg-text-3)",
          padding: "0 2px",
          fontStyle: "italic",
        }}
      >
        Cashflow ({period.label}): ingresó {fMoney(cashFlow.cashIn)} · salió{" "}
        {fMoney(cashFlow.cashOut)} · neto {fMoney(cashFlow.netCashFlow)}
        {assets.length > 0 &&
          ` · ${assets.filter((a) => a.active).length} activos, ${liabilities.filter((l) => l.active && l.settled_at == null).length} pasivos`}
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
  tone,
}: {
  readonly label: string;
  readonly value: string;
  readonly hint: string;
  readonly tone?: "negative" | "warning";
}) {
  const border =
    tone === "negative"
      ? "1px solid rgba(240,64,96,0.4)"
      : tone === "warning"
        ? "1px solid rgba(255,184,0,0.4)"
        : "1px solid var(--kg-border-subtle)";
  return (
    <div
      className="kg-glass"
      style={{
        borderRadius: "var(--kg-r-16)",
        padding: "16px 18px",
        boxShadow: "var(--kg-shadow-amb)",
        border,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div
        className="kg-t7"
        style={{
          color: "var(--kg-text-3)",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: 0.3,
        }}
      >
        {label}
      </div>
      <div
        style={{
          color: tone === "negative" ? "#F04060" : "var(--kg-text-1)",
          fontSize: 24,
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
      <div className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
        {hint}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Tendencia de ingreso — 12 meses cronológicos con delta MoM
// ═══════════════════════════════════════════════════════════════════════════
//
// Server component puro. Recibe los buckets ya computados con la misma
// lógica que /financiero (misma conversión a USD, mismo tratamiento de
// ownership propia vs externa). Renderiza barras SVG proporcionales al
// máximo + etiquetas de mes + montos. El último bucket es el mes en curso
// (parcial) y se dibuja con estilo tenue para distinguirlo de los cerrados.
//
// No usa recharts: 12 barras con labels es un caso donde SVG plano es más
// rápido, más liviano y matchea el look minimalista del resto de KG.

function RevenueTrend({
  buckets,
  delta,
  periodLabel,
}: {
  readonly buckets: ReadonlyArray<{
    readonly key: string;
    readonly label: string;
    readonly revenue: number;
  }>;
  readonly delta: { readonly pct: number; readonly dir: "up" | "down" } | null;
  readonly periodLabel: string;
}) {
  const values = buckets.map((b) => b.revenue);
  const max = Math.max(0, ...values);
  const allZero = values.every((v) => v === 0);

  if (allZero) {
    return (
      <EmptyState
        title="Sin ingresos en los últimos 12 meses"
        hint="Cuando se cierren liquidaciones o entren facturas cobradas de proyectos propios van a aparecer acá."
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div className="kg-t7" style={{ color: "var(--kg-text-3)", lineHeight: 1.5 }}>
          El KPI de arriba muestra el ingreso del período{" "}
          <strong style={{ color: "var(--kg-text-2)" }}>{periodLabel}</strong>.
          El gráfico compara todos los meses en el mismo criterio (USD, con
          la misma conversión FX del dashboard financiero).
        </div>
        {delta && (
          <div
            className="kg-t7"
            style={{
              color: delta.dir === "up" ? "#00D084" : "#F04060",
              fontWeight: 700,
              whiteSpace: "nowrap",
            }}
          >
            Último mes cerrado {delta.dir === "up" ? "▲" : "▼"}{" "}
            {Math.round(delta.pct * 100)}% MoM
          </div>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))`,
          gap: 6,
          alignItems: "end",
          minHeight: 140,
        }}
      >
        {buckets.map((b, idx) => {
          const isCurrent = idx === buckets.length - 1;
          const pct = max > 0 ? Math.max(4, (b.revenue / max) * 100) : 0;
          return (
            <div
              key={b.key}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
              }}
              title={`${b.label}: ${fMoney(b.revenue)}`}
            >
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: "var(--kg-text-3)",
                  fontVariantNumeric: "tabular-nums",
                  height: 14,
                }}
              >
                {b.revenue > 0 ? fMoney(b.revenue) : ""}
              </div>
              <div
                style={{
                  width: "100%",
                  height: 100,
                  display: "flex",
                  alignItems: "flex-end",
                }}
              >
                <div
                  style={{
                    width: "100%",
                    height: `${pct}%`,
                    background: isCurrent
                      ? "var(--kg-neutral-500)"
                      : "var(--kg-accent-500)",
                    opacity: isCurrent ? 0.4 : 0.85,
                    borderRadius: "4px 4px 0 0",
                    transition: "height 300ms ease-out",
                  }}
                />
              </div>
              <div
                className="kg-t7"
                style={{
                  color: isCurrent ? "var(--kg-text-3)" : "var(--kg-text-2)",
                  fontSize: 10,
                  textTransform: "capitalize",
                }}
              >
                {b.label}
              </div>
            </div>
          );
        })}
      </div>

      <div
        className="kg-t7"
        style={{
          color: "var(--kg-text-3)",
          fontSize: 10,
          opacity: 0.7,
        }}
      >
        El mes en curso está incompleto (barra tenue). Para números finales,
        mirá el mes anterior cerrado.
      </div>
    </div>
  );
}

function AlertRow({
  href,
  label,
  tone,
}: {
  readonly href: string;
  readonly label: string;
  readonly tone: "critical" | "warning";
}) {
  const color = tone === "critical" ? "#F04060" : "#FFB800";
  return (
    <Link
      href={href}
      className="kg-focus"
      style={{
        padding: "10px 14px",
        borderRadius: "var(--kg-r-8)",
        background: "var(--kg-surface-2-solid)",
        border: `1px solid ${color}`,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 8,
        color: "var(--kg-text-1)",
        fontSize: 13,
        fontWeight: 600,
        textDecoration: "none",
      }}
    >
      <span>{label}</span>
      <span style={{ color, fontSize: 14, fontWeight: 700 }}>→</span>
    </Link>
  );
}

function firstParam(v: string | string[] | undefined): string | null {
  if (typeof v === "string" && v.length > 0) return v;
  if (Array.isArray(v) && v.length > 0 && v[0]) return v[0]!;
  return null;
}

function formatPct(v: number | null): string {
  if (v == null) return "—";
  const rounded = Math.round(v * 10) / 10;
  if (Number.isInteger(rounded)) return `${rounded}%`;
  return `${rounded.toFixed(1)}%`;
}

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const thStyle: React.CSSProperties = {
  padding: "8px 12px 8px 0",
  textAlign: "left",
  color: "var(--kg-text-3)",
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: 0.3,
  borderBottom: "1px solid var(--kg-border-subtle)",
};

const tdStyle: React.CSSProperties = {
  padding: "10px 12px 10px 0",
  color: "var(--kg-text-2)",
  fontSize: 12,
};

const numStyle: React.CSSProperties = {
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};
