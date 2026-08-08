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
import {
  inPeriodDate,
  inPeriodTs,
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
  ] = await Promise.all([
    supabase.from("projects").select("id, name, ownership"),
    supabase.from("banks").select("id, balance, opening_balance"),
    supabase
      .from("bank_movements")
      .select("bank_id, amount, kind, occurred_at"),
    supabase
      .from("expenses")
      .select(
        "amount_gross, tax_amount, category, paid_at, due_date, expense_date",
      ),
    supabase
      .from("payroll")
      .select("total_amount, paid_at, due_date, period_start, period_end"),
    supabase
      .from("invoices")
      .select(
        "project_id, launch_id, amount_gross, tax_amount, status, paid_at, due_date, issue_date",
      ),
    supabase.from("assets").select("amount, active"),
    supabase.from("liabilities").select("amount, active, settled_at"),
    supabase.from("client_transfers").select("amount, direction, date"),
    supabase
      .from("launch_settlements")
      .select("kingrow_retained, status, closed_at, created_at"),
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
    (settlementsRes.data ?? []) as unknown as FinanceLaunchSettlementRow[];

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

  // Revenue Kingrow del período — settlements + invoices ya filtradas.
  const revenue = computeRevenue({
    settlements: settlementsInPeriod,
    invoices: invoicesCollectedInPeriod,
    resolveOwnership,
  });

  // Profit del período (simple: sin split directo/operativo — el
  // dashboard financiero lo desglosa mejor).
  const expensesNet = sumExpensesNet(expensesInPeriod);
  const payrollTotal = sumPayrollTotal(payrollInPeriod);
  const profit = computeProfit({
    revenue: revenue.revenueTotal,
    operatingExpenses: expensesNet,
    payroll: payrollTotal,
  });

  // Caja actual = Σ total en bancos.
  // Cast: computeBankBalances solo lee id + opening_balance del BankRow,
  // pero el type completo tiene más columnas. Sub-set seguro.
  const bankBalancesMap = computeBankBalances(
    banks as never,
    bankMovements.map((m) => ({
      bank_id: m.bank_id,
      amount: m.amount,
      kind: m.kind,
    })),
  );
  let bankBalanceTotal = 0;
  for (const b of bankBalancesMap.values()) bankBalanceTotal += b.total;

  // AR de Kingrow. `favorKingrowBalance` es positivo cuando algún cliente
  // le debe a Kingrow (clientBalance negativo).
  const rawClientBalance = clientBalance(allClientTransfers);
  const favorKingrowBalance = Math.max(0, -rawClientBalance);
  const ar = computeAccountsReceivable({
    invoices: allInvoices,
    resolveOwnership,
    favorKingrowBalance,
  });

  // Burn rate + runway.
  const burnRate = computeBurnRate({
    expenses: expensesInPeriod,
    payroll: payrollInPeriod,
    monthsInWindow: period.monthsInWindow,
  });
  const runwayClass = classifyRunway({
    cashOnHand: bankBalanceTotal,
    monthlyBurn: burnRate,
    snapshotStale: false,
  });

  const cashFlow = computeCashFlow({
    bankMovements: bankMovementsInPeriod,
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
  const ap = computeAccountsPayable({
    expenses: allExpenses,
    payroll: allPayroll,
    clientTransfers: allClientTransfers,
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
          { l: "Caja", v: fMoney(bankBalanceTotal) },
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
