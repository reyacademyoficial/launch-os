import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { IconFin } from "@/components/kg/icons";
import { KgParamPills } from "@/components/kg/param-pills";
import { Panel } from "@/components/kg/panel";
import { fCount, fMoney } from "@/lib/finance/format";
import { createClient } from "@/lib/supabase/server";

import { ActivosView, type AssetRowData } from "./activos-view";

export const metadata: Metadata = { title: "Activos · Financiero" };

// Activos son SNAPSHOTS, no eventos — no aplica filtro de período. Filtro
// por estado (activo/dado de baja) sí, para poder ver los dados de baja.
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
  readonly description: string | null;
  readonly amount: number;
  readonly original_cost: number | null;
  readonly depreciation: number;
  readonly currency: string | null;
  readonly acquired_at: string | null;
  readonly active: boolean;
  readonly notes: string | null;
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
      "id, name, asset_type, description, amount, original_cost, depreciation, currency, acquired_at, active, notes",
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

  const rows: AssetRowData[] = assets.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.asset_type,
    description: a.description,
    amount: Number(a.amount),
    original: a.original_cost == null ? null : Number(a.original_cost),
    depreciation: Number(a.depreciation),
    currency: a.currency ?? "ARS",
    acquiredAt: a.acquired_at,
    notes: a.notes,
    active: a.active,
  }));

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
        <ActivosView rows={rows} totalCount={totalCount} />
      </Panel>
    </div>
  );
}

function parseActive(v: string | string[] | undefined): ActiveParam {
  if (typeof v !== "string") return "activos";
  const allowed: ActiveParam[] = ["activos", "inactivos", "todos"];
  return (allowed as string[]).includes(v) ? (v as ActiveParam) : "activos";
}
