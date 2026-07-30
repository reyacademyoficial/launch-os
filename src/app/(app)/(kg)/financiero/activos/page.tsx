import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { KgDataTable, type Column } from "@/components/kg/data-table";
import { IconFin } from "@/components/kg/icons";
import { KgParamPills } from "@/components/kg/param-pills";
import { Panel } from "@/components/kg/panel";
import { fCount, fMoney } from "@/lib/finance/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Activos · Financiero" };

// Activos son SNAPSHOTS, no eventos — no aplica filtro de período. Filtro
// por 'active'/'inactivo' sí, para poder ver los dados de baja.
type ActiveParam = "activos" | "inactivos" | "todos";

const ACTIVE_OPTIONS: ReadonlyArray<{ value: ActiveParam; label: string }> = [
  { value: "activos", label: "Activos" },
  { value: "inactivos", label: "Dados de baja" },
  { value: "todos", label: "Todos" },
];

interface AssetDbRow {
  readonly id: string;
  readonly name: string;
  readonly asset_type: string;
  readonly amount: number;
  readonly original_cost: number | null;
  readonly depreciation: number;
  readonly acquired_at: string | null;
  readonly active: boolean;
}

export default async function ActivosPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const activeParam = parseActive(sp.state);

  const supabase = await createClient();
  let query = supabase
    .from("assets")
    .select(
      "id, name, asset_type, amount, original_cost, depreciation, acquired_at, active",
    )
    .order("amount", { ascending: false });

  if (activeParam === "activos") query = query.eq("active", true);
  else if (activeParam === "inactivos") query = query.eq("active", false);

  const assetsRes = await query;
  const assets = (assetsRes.data ?? []) as unknown as AssetDbRow[];

  const totalCount = assets.length;
  const totalAmount = assets
    .filter((a) => a.active)
    .reduce((acc, a) => acc + Number(a.amount), 0);
  const totalOriginal = assets.reduce(
    (acc, a) => acc + Number(a.original_cost ?? 0),
    0,
  );
  const totalDepreciation = assets.reduce(
    (acc, a) => acc + Number(a.depreciation),
    0,
  );

  interface Row {
    readonly id: string;
    readonly name: string;
    readonly type: string;
    readonly amount: number;
    readonly original: number | null;
    readonly depreciation: number;
    readonly acquiredAt: string | null;
    readonly active: boolean;
  }
  const rows: Row[] = assets.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.asset_type,
    amount: Number(a.amount),
    original: a.original_cost == null ? null : Number(a.original_cost),
    depreciation: Number(a.depreciation),
    acquiredAt: a.acquired_at,
    active: a.active,
  }));

  const columns: Column<Row>[] = [
    { key: "name", label: "Nombre", render: (r) => r.name },
    { key: "type", label: "Tipo", render: (r) => r.type },
    {
      key: "amount",
      label: "Valor libros",
      align: "right",
      numeric: true,
      render: (r) => fMoney(r.amount),
    },
    {
      key: "original",
      label: "Costo original",
      align: "right",
      numeric: true,
      render: (r) => (r.original == null ? "—" : fMoney(r.original)),
    },
    {
      key: "depreciation",
      label: "Depreciación",
      align: "right",
      numeric: true,
      render: (r) => fMoney(r.depreciation),
    },
    {
      key: "acquired",
      label: "Adquisición",
      render: (r) => (r.acquiredAt ? fmtDate(r.acquiredAt) : "—"),
    },
    {
      key: "active",
      label: "Estado",
      render: (r) => <ActivePill active={r.active} />,
    },
  ];

  function buildHref(state: ActiveParam): string {
    if (state === "activos") return "/financiero/activos";
    return `/financiero/activos?state=${state}`;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconFin size={16} />}
        title="Activos"
        stats={[
          { l: "En la vista", v: fCount(totalCount) },
          { l: "Valor libros activo", v: fMoney(totalAmount) },
          { l: "Costo original acum.", v: fMoney(totalOriginal) },
          { l: "Depreciación acum.", v: fMoney(totalDepreciation) },
        ]}
      />

      <div style={{ display: "flex", gap: 10 }}>
        <KgParamPills
          ariaLabel="Filtrar por estado"
          options={ACTIVE_OPTIONS.map((o) => ({
            label: o.label,
            href: buildHref(o.value),
            active: activeParam === o.value,
          }))}
        />
      </div>

      <Panel title="Activos" pad={false}>
        <KgDataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          totalCount={totalCount}
          emptyTitle="No hay activos registrados"
          emptyHint="Los activos alimentan la tarjeta Caja del dashboard (los tipo caja/banco) y el Patrimonio neto (la suma total). Sin activos cargados esos dos KPIs quedan vacíos."
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
function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function ActivePill({ active }: { readonly active: boolean }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px",
        borderRadius: 999,
        background: active
          ? "rgba(0,208,132,0.15)"
          : "rgba(138,138,153,0.15)",
        color: active ? "#00D084" : "var(--kg-text-2)",
        fontSize: 11,
        fontWeight: 700,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: active ? "#00D084" : "#8A8A99",
          display: "inline-block",
        }}
      />
      {active ? "Activo" : "Dado de baja"}
    </span>
  );
}
