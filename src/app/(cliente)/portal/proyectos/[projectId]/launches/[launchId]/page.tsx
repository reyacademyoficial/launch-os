import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DailyChart } from "@/components/dashboard/launches/daily/daily-chart";
import { KpiGrid } from "@/components/dashboard/launches/kpi-grid";
import { StatusBadge } from "@/components/dashboard/launches/status-badge";
import { fmtLaunchWindow } from "@/lib/format";
import { calculateLaunchKPIs } from "@/lib/kpis";
import { aggregateMergedDaily } from "@/lib/launch-daily/aggregate";
import { listAdsForLaunch, listDailyForLaunch } from "@/lib/launch-daily/list";
import { mergeDailyData } from "@/lib/launch-daily/merge";
import { getKanbanSalesAggregateForLaunch } from "@/lib/launch-sales/list";
import { getLaunch } from "@/lib/launches/get";

export const metadata: Metadata = { title: "Lanzamiento · Portal" };

/**
 * Detalle ejecutivo del launch para el cliente.
 *
 * Plano: KPIs + chart de leads por día. Sin tabs de integraciones, IA,
 * calendario o equipo. La carga de datos diarios y la edición tampoco
 * aparecen — el cliente solo mira.
 */
export default async function ClientLaunchPage({
  params,
}: {
  readonly params: Promise<{ projectId: string; launchId: string }>;
}) {
  const { projectId, launchId } = await params;

  const [launch, daily, ads, kanbanSalesAggregate] = await Promise.all([
    getLaunch(launchId),
    listDailyForLaunch(launchId),
    listAdsForLaunch(launchId),
    getKanbanSalesAggregateForLaunch(projectId, launchId),
  ]);

  if (!launch || launch.project_id !== projectId) notFound();

  const mergedDaily = mergeDailyData(daily, ads);
  const adsAggregate =
    mergedDaily.length > 0 ? aggregateMergedDaily(mergedDaily) : undefined;
  const kpi = calculateLaunchKPIs(launch, { adsAggregate, kanbanSalesAggregate });

  return (
    <section className="space-y-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-baseline gap-3">
            <h1 className="text-2xl font-bold">{launch.name}</h1>
            <StatusBadge status={launch.status} />
          </div>
          <p className="text-xs text-fg-subtle">
            {fmtLaunchWindow(launch.date_start, launch.date_end)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`/portal/proyectos/${projectId}/launches/${launchId}/ia`}
            className="inline-flex items-center rounded-md border border-border bg-surface px-3 py-2 text-sm font-semibold text-fg hover:bg-bg-elevated"
          >
            Análisis IA
          </a>
          <a
            href={`/api/portal/proyectos/${projectId}/launches/${launchId}/report/executive`}
            className="inline-flex items-center rounded-md border border-border bg-surface px-3 py-2 text-sm font-semibold text-fg hover:bg-bg-elevated"
          >
            Descargar PDF
          </a>
        </div>
      </header>

      <KpiGrid kpi={kpi} />

      {mergedDaily.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-fg">Evolución diaria</h2>
          <p className="text-xs text-fg-subtle">
            Leads por canal a lo largo del lanzamiento.
          </p>
          <DailyChart rows={mergedDaily} />
        </section>
      )}
    </section>
  );
}
