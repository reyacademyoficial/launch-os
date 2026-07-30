import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { KgDataTable, type Column } from "@/components/kg/data-table";
import { IconFin } from "@/components/kg/icons";
import { KgParamPills } from "@/components/kg/param-pills";
import { Panel } from "@/components/kg/panel";
import { fCount, fMoney } from "@/lib/finance/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Pasivos · Financiero" };

// Pasivos son SNAPSHOTS — sin filtro de período. Filtro por estado
// (vigentes / saldados / todos) — un pasivo saldado sigue en la tabla como
// histórico pero no aparece en `computeNetWorth` (settled_at IS NOT NULL).
type StateParam = "vigentes" | "saldados" | "todos";

const STATE_OPTIONS: ReadonlyArray<{ value: StateParam; label: string }> = [
  { value: "vigentes", label: "Vigentes" },
  { value: "saldados", label: "Saldados" },
  { value: "todos", label: "Todos" },
];

interface LiabilityDbRow {
  readonly id: string;
  readonly name: string;
  readonly liability_type: string;
  readonly amount: number;
  readonly incurred_at: string | null;
  readonly due_date: string | null;
  readonly settled_at: string | null;
  readonly active: boolean;
}

export default async function PasivosPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const stateParam = parseState(sp.state);

  const supabase = await createClient();
  let query = supabase
    .from("liabilities")
    .select(
      "id, name, liability_type, amount, incurred_at, due_date, settled_at, active",
    )
    .order("amount", { ascending: false });

  if (stateParam === "vigentes") {
    query = query.eq("active", true).is("settled_at", null);
  } else if (stateParam === "saldados") {
    query = query.not("settled_at", "is", null);
  }

  const res = await query;
  const liabilities = (res.data ?? []) as unknown as LiabilityDbRow[];

  const totalCount = liabilities.length;
  const totalVigente = liabilities
    .filter((l) => l.active && l.settled_at == null)
    .reduce((acc, l) => acc + Number(l.amount), 0);

  interface Row {
    readonly id: string;
    readonly name: string;
    readonly type: string;
    readonly amount: number;
    readonly incurredAt: string | null;
    readonly dueDate: string | null;
    readonly settledAt: string | null;
    readonly active: boolean;
  }
  const rows: Row[] = liabilities.map((l) => ({
    id: l.id,
    name: l.name,
    type: l.liability_type,
    amount: Number(l.amount),
    incurredAt: l.incurred_at,
    dueDate: l.due_date,
    settledAt: l.settled_at,
    active: l.active,
  }));

  const columns: Column<Row>[] = [
    { key: "name", label: "Nombre", render: (r) => r.name },
    { key: "type", label: "Tipo", render: (r) => r.type },
    {
      key: "amount",
      label: "Monto",
      align: "right",
      numeric: true,
      render: (r) => fMoney(r.amount),
    },
    {
      key: "incurred",
      label: "Incurrido",
      render: (r) => (r.incurredAt ? fmtDate(r.incurredAt) : "—"),
    },
    {
      key: "due",
      label: "Vence",
      render: (r) => (r.dueDate ? fmtDate(r.dueDate) : "—"),
    },
    {
      key: "state",
      label: "Estado",
      render: (r) => <StatePill row={r} />,
    },
  ];

  function buildHref(state: StateParam): string {
    if (state === "vigentes") return "/financiero/pasivos";
    return `/financiero/pasivos?state=${state}`;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconFin size={16} />}
        title="Pasivos"
        stats={[
          { l: "En la vista", v: fCount(totalCount) },
          { l: "Deuda vigente", v: fMoney(totalVigente) },
        ]}
      />

      <div style={{ display: "flex", gap: 10 }}>
        <KgParamPills
          ariaLabel="Filtrar por estado"
          options={STATE_OPTIONS.map((o) => ({
            label: o.label,
            href: buildHref(o.value),
            active: stateParam === o.value,
          }))}
        />
      </div>

      <Panel title="Pasivos" pad={false}>
        <KgDataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          totalCount={totalCount}
          emptyTitle="No hay pasivos registrados"
          emptyHint="Los pasivos vigentes (active=true AND settled_at IS NULL) restan del Patrimonio neto del dashboard. Sin pasivos cargados, el patrimonio se estima solo por activos + AP corriente."
        />
      </Panel>
    </div>
  );
}

function parseState(v: string | string[] | undefined): StateParam {
  if (typeof v !== "string") return "vigentes";
  const allowed: StateParam[] = ["vigentes", "saldados", "todos"];
  return (allowed as string[]).includes(v) ? (v as StateParam) : "vigentes";
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

function StatePill({
  row,
}: {
  readonly row: {
    readonly settledAt: string | null;
    readonly active: boolean;
  };
}) {
  let label: string;
  let bg: string;
  let fg: string;
  let dot: string;
  if (row.settledAt != null) {
    label = `Saldado ${fmtDate(row.settledAt)}`;
    bg = "rgba(0,208,132,0.15)";
    fg = "#00D084";
    dot = "#00D084";
  } else if (!row.active) {
    label = "Inactivo";
    bg = "rgba(138,138,153,0.15)";
    fg = "var(--kg-text-2)";
    dot = "#8A8A99";
  } else {
    label = "Vigente";
    bg = "rgba(255,184,0,0.15)";
    fg = "#FFB800";
    dot = "#FFB800";
  }
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px",
        borderRadius: 999,
        background: bg,
        color: fg,
        fontSize: 11,
        fontWeight: 700,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: dot,
          display: "inline-block",
        }}
      />
      {label}
    </span>
  );
}
