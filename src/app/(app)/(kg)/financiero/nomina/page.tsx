import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { KgDataTable, type Column } from "@/components/kg/data-table";
import { IconFin } from "@/components/kg/icons";
import { KgParamPills } from "@/components/kg/param-pills";
import { Panel } from "@/components/kg/panel";
import { fCount, fMoney } from "@/lib/finance/format";
import { overlapsPeriodDate, resolvePeriod, type Period } from "@/lib/finance/period";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Nómina · Financiero" };

// Payroll no tiene volumen alto — cargamos todo y filtramos en TS. Sin
// paginación por ahora: si crece a >200 filas se agrega igual que gastos.

type PaidParam = "todos" | "pagado" | "impago";
type RangeParam = "todo" | "mes-actual" | "mes-anterior" | "90d";

const PAID_OPTIONS: ReadonlyArray<{ value: PaidParam; label: string }> = [
  { value: "todos", label: "Todos" },
  { value: "pagado", label: "Pagados" },
  { value: "impago", label: "Impagos" },
];
const RANGE_OPTIONS: ReadonlyArray<{ value: RangeParam; label: string }> = [
  { value: "todo", label: "Todo" },
  { value: "mes-actual", label: "Mes actual" },
  { value: "mes-anterior", label: "Mes anterior" },
  { value: "90d", label: "90 días" },
];

interface PayrollDbRow {
  readonly id: string;
  readonly person_id: string;
  readonly period_start: string;
  readonly period_end: string;
  readonly base_salary: number;
  readonly total_amount: number;
  readonly due_date: string | null;
  readonly paid_at: string | null;
}

interface PersonRow {
  readonly id: string;
  readonly name: string;
}

export default async function NominaPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const paidParam = parsePaid(sp.paid);
  const rangeParam = parseRange(sp.range);

  const period: Period | null =
    rangeParam === "todo" ? null : resolvePeriod({ range: rangeParam });

  const supabase = await createClient();
  const [payrollRes, peopleRes] = await Promise.all([
    supabase
      .from("payroll")
      .select(
        "id, person_id, period_start, period_end, base_salary, total_amount, due_date, paid_at",
      )
      .order("period_end", { ascending: false }),
    supabase.from("organization_people").select("id, name"),
  ]);

  const allRows = (payrollRes.data ?? []) as unknown as PayrollDbRow[];
  const personById = new Map<string, string>(
    ((peopleRes.data ?? []) as PersonRow[]).map((p) => [p.id, p.name]),
  );

  const filtered = allRows.filter((p) => {
    if (paidParam === "pagado" && p.paid_at == null) return false;
    if (paidParam === "impago" && p.paid_at != null) return false;
    if (period && !overlapsPeriodDate(p.period_start, p.period_end, period))
      return false;
    return true;
  });

  const totalCount = filtered.length;
  const totalAmount = filtered.reduce((a, p) => a + Number(p.total_amount), 0);
  const impagoAmount = filtered
    .filter((p) => p.paid_at == null)
    .reduce((a, p) => a + Number(p.total_amount), 0);

  interface Row {
    readonly id: string;
    readonly person: string;
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly baseSalary: number;
    readonly totalAmount: number;
    readonly dueDate: string | null;
    readonly paidAt: string | null;
  }
  const rows: Row[] = filtered.map((p) => ({
    id: p.id,
    person: personById.get(p.person_id) ?? "—",
    periodStart: p.period_start,
    periodEnd: p.period_end,
    baseSalary: Number(p.base_salary),
    totalAmount: Number(p.total_amount),
    dueDate: p.due_date,
    paidAt: p.paid_at,
  }));

  const columns: Column<Row>[] = [
    { key: "person", label: "Persona", render: (r) => r.person },
    {
      key: "period",
      label: "Período",
      render: (r) => `${fmtDate(r.periodStart)} – ${fmtDate(r.periodEnd)}`,
    },
    {
      key: "base",
      label: "Base",
      align: "right",
      numeric: true,
      render: (r) => fMoney(r.baseSalary),
    },
    {
      key: "total",
      label: "Total",
      align: "right",
      numeric: true,
      render: (r) => fMoney(r.totalAmount),
    },
    {
      key: "due",
      label: "Vence",
      render: (r) => (r.dueDate ? fmtDate(r.dueDate) : "—"),
    },
    {
      key: "paid",
      label: "Estado",
      render: (r) => <PaidPill paidAt={r.paidAt} />,
    },
  ];

  function buildHref(overrides: {
    paid?: PaidParam;
    range?: RangeParam;
  }): string {
    const nextPaid = overrides.paid ?? paidParam;
    const nextRange = overrides.range ?? rangeParam;
    const params = new URLSearchParams();
    if (nextPaid !== "todos") params.set("paid", nextPaid);
    if (nextRange !== "todo") params.set("range", nextRange);
    const qs = params.toString();
    return qs ? `/financiero/nomina?${qs}` : "/financiero/nomina";
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconFin size={16} />}
        title="Nómina"
        stats={[
          { l: "Liquidaciones en la vista", v: fCount(totalCount) },
          { l: "Total", v: fMoney(totalAmount) },
          { l: "Impagas", v: fMoney(impagoAmount) },
        ]}
      />

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <KgParamPills
          ariaLabel="Filtrar por estado de pago"
          options={PAID_OPTIONS.map((o) => ({
            label: o.label,
            href: buildHref({ paid: o.value }),
            active: paidParam === o.value,
          }))}
        />
        <KgParamPills
          ariaLabel="Filtrar por período"
          options={RANGE_OPTIONS.map((o) => ({
            label: o.label,
            href: buildHref({ range: o.value }),
            active: rangeParam === o.value,
          }))}
        />
      </div>

      <Panel title="Nómina" pad={false}>
        <KgDataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          totalCount={totalCount}
          emptyTitle="No hay nómina cargada"
          emptyHint="Sin nómina cargada, el KPI Nómina del período queda en cero y el Burn mensual se subestima — el runway del dashboard sale inflado. Los movimientos bancarios de sueldos (pestaña Movimientos) NO alimentan estos KPIs — hace falta cargar el registro de nómina acá."
        />
      </Panel>
    </div>
  );
}

function parsePaid(v: string | string[] | undefined): PaidParam {
  if (typeof v !== "string") return "todos";
  const allowed: PaidParam[] = ["todos", "pagado", "impago"];
  return (allowed as string[]).includes(v) ? (v as PaidParam) : "todos";
}
function parseRange(v: string | string[] | undefined): RangeParam {
  if (typeof v !== "string") return "todo";
  const allowed: RangeParam[] = ["todo", "mes-actual", "mes-anterior", "90d"];
  return (allowed as string[]).includes(v) ? (v as RangeParam) : "todo";
}
function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function PaidPill({ paidAt }: { readonly paidAt: string | null }) {
  const paid = paidAt != null;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px",
        borderRadius: 999,
        background: paid ? "rgba(0,208,132,0.15)" : "rgba(138,138,153,0.15)",
        color: paid ? "#00D084" : "var(--kg-text-2)",
        fontSize: 11,
        fontWeight: 700,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: paid ? "#00D084" : "#8A8A99",
          display: "inline-block",
        }}
      />
      {paid ? `Pagado ${fmtDate(paidAt!)}` : "Impago"}
    </span>
  );
}
