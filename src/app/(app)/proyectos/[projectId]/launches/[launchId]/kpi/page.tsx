import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CommunityKpiBlock } from "@/components/dashboard/launches/community-kpi-block";
import { DailyChart } from "@/components/dashboard/launches/daily/daily-chart";
import { DailyFormModal } from "@/components/dashboard/launches/daily/daily-form-modal";
import { DailyTable } from "@/components/dashboard/launches/daily/daily-table";
import { RealtimeProbe } from "@/components/dashboard/launches/integrations/realtime-probe";
import { KpiGrid } from "@/components/dashboard/launches/kpi-grid";
import { calculateLaunchKPIs } from "@/lib/kpis";
import { aggregateCommunityMetrics } from "@/lib/launch-community/aggregate";
import { listCommunityMetricsForLaunch } from "@/lib/launch-community/list";
import { aggregateMergedDaily } from "@/lib/launch-daily/aggregate";
import { listAdsForLaunch, listDailyForLaunch } from "@/lib/launch-daily/list";
import { mergeDailyData } from "@/lib/launch-daily/merge";
import { getKanbanSalesAggregateForLaunch } from "@/lib/launch-sales/list";
import { getLaunch } from "@/lib/launches/get";
import { userCanEditLaunchesIn } from "@/lib/supabase/auth";

import { createDailyEntry } from "../daily-actions";

export const metadata: Metadata = { title: "KPI · Lanzamiento" };

/**
 * Tab principal: KPIs, carga manual de datos diarios y gráfico merged.
 * El header + tabs los pone el layout padre — esta page solo renderiza el
 * contenido del tab activo.
 */
export default async function LaunchKpiPage({
  params,
}: {
  readonly params: Promise<{ projectId: string; launchId: string }>;
}) {
  const { projectId, launchId } = await params;

  const [launch, canEditLaunchValue, daily, ads, kanbanSalesAggregate, community] =
    await Promise.all([
      getLaunch(launchId),
      userCanEditLaunchesIn(projectId),
      listDailyForLaunch(launchId),
      listAdsForLaunch(launchId),
      getKanbanSalesAggregateForLaunch(projectId, launchId),
      listCommunityMetricsForLaunch(launchId),
    ]);

  if (!launch || launch.project_id !== projectId) notFound();

  const mergedDaily = mergeDailyData(daily, ads);
  const adsAggregate = aggregateMergedDaily(mergedDaily);
  const communityAggregate = aggregateCommunityMetrics(community);
  const kpi = calculateLaunchKPIs(launch, {
    adsAggregate,
    kanbanSalesAggregate,
    communityAggregate,
  });
  const isClosed = launch.closed_at !== null;
  const addDailyAction = createDailyEntry.bind(null, projectId, launchId);

  return (
    <div className="space-y-10">
      <KpiGrid kpi={kpi} />

      <CommunityKpiBlock kpi={kpi} />

      <section className="space-y-4">
        <header className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-fg">Datos diarios</h2>
            <p className="text-xs text-fg-subtle">
              Leads por canal por día. Alimenta el gráfico de abajo.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canEditLaunchValue && mergedDaily.length > 0 && (
              <a
                href={`/api/proyectos/${projectId}/launches/${launchId}/daily/export?format=csv`}
                className="inline-flex items-center rounded-md border border-border bg-surface px-3 py-2 text-sm font-semibold text-fg hover:bg-bg-elevated"
              >
                ⬇ Exportar CSV
              </a>
            )}
            {canEditLaunchValue && !isClosed && (
              <DailyFormModal
                triggerLabel="+ Agregar día"
                title="Agregar día"
                submitLabel="Guardar"
                action={addDailyAction}
              />
            )}
            {canEditLaunchValue && isClosed && (
              <p className="text-xs text-fg-subtle">
                Lanzamiento cerrado — no se pueden cargar más datos.
              </p>
            )}
          </div>
        </header>

        {daily.length === 0 && mergedDaily.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-surface/40 p-8 text-center text-sm text-fg-muted">
            Sin datos diarios cargados.
            {canEditLaunchValue
              ? " Agregá uno a mano o configurá la integración para que la API los traiga sola."
              : " El admin u operador del proyecto los va a cargar."}
          </div>
        ) : (
          <>
            <DailyTable
              rows={daily}
              canEdit={canEditLaunchValue && !isClosed}
              projectId={projectId}
              launchId={launchId}
            />
            <div className="rounded-md border border-border bg-surface/40 p-4">
              <DailyChart rows={mergedDaily} />
            </div>
          </>
        )}
      </section>

      {/* Probe de realtime para que el chart/tabla refresh cuando el sync
          escribe nuevas filas de ads. Vivía en el page monolítico; lo dejamos
          en este tab que es donde el efecto es visible. */}
      <RealtimeProbe launchId={launchId} />
    </div>
  );
}
