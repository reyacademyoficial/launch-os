import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { IconFin } from "@/components/kg/icons";
import { Panel } from "@/components/kg/panel";
import { fCount } from "@/lib/finance/format";
import { listAccessibleProjects } from "@/lib/projects/list";
import { createClient } from "@/lib/supabase/server";

import { BackfillView } from "./backfill-view";
import { TasasView, type FxRateRowData, type ProjectOption } from "./tasas-view";

export const metadata: Metadata = { title: "Tasas FX · Financiero" };

// ═══════════════════════════════════════════════════════════════════════════
// Tasas mensuales por proyecto (mig 0103, tabla `project_fx_rates`).
//
// Se usan para convertir a USD movimientos que NO están atados a un
// lanzamiento: gastos, nómina, movimientos de banco manuales, facturas.
// Los cobros/spend con launch usan la tasa del propio launch.
//
// Sin filtros (por ahora) — la tabla es chica (~12 rows/proyecto/año) y
// una lista plana ordenada por mes desc alcanza para operar.
// ═══════════════════════════════════════════════════════════════════════════

interface RawFxRateRow {
  readonly id: string;
  readonly project_id: string;
  readonly month: string;
  readonly ars_per_usd: number;
}

export default async function TasasPage() {
  const supabase = await createClient();

  const [projects, ratesRes] = await Promise.all([
    listAccessibleProjects(),
    supabase
      .from("project_fx_rates")
      .select("id, project_id, month, ars_per_usd")
      .order("month", { ascending: false }),
  ]);
  const rates = (ratesRes.data ?? []) as unknown as RawFxRateRow[];

  const projectById = new Map(projects.map((p) => [p.id, p]));
  const rows: FxRateRowData[] = rates.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    projectName: projectById.get(r.project_id)?.name ?? "—",
    month: r.month,
    arsPerUsd: Number(r.ars_per_usd),
  }));

  const projectsForForm: ProjectOption[] = projects.map((p) => ({
    id: p.id,
    name: p.name,
  }));

  const totalCount = rows.length;
  const projectsWithRates = new Set(rows.map((r) => r.projectId)).size;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ContextBar
        icon={<IconFin size={16} />}
        title="Tasas FX mensuales"
        stats={[
          { l: "Tasas cargadas", v: fCount(totalCount) },
          { l: "Proyectos con tasa", v: fCount(projectsWithRates) },
        ]}
      />

      <Panel title="Tasas por proyecto y mes" pad={false}>
        <TasasView
          rows={rows}
          projects={projectsForForm}
          totalCount={totalCount}
        />
      </Panel>

      <Panel title="Backfill de cobros históricos" pad={false}>
        <BackfillView />
      </Panel>
    </div>
  );
}
