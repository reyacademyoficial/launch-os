import type { Metadata } from "next";
import Link from "next/link";

import { StatusBadge } from "@/components/dashboard/launches/status-badge";
import { fmtLaunchWindow, fmtMultiplier } from "@/lib/format";
import { calculateLaunchKPIs } from "@/lib/kpis";
import { listAggregatesForProject } from "@/lib/launch-daily/list";
import {
  getKanbanSalesAggregatesForProject,
  getProjectRevenueUsdMap,
} from "@/lib/launch-sales/list";
import { listLaunchesForProject } from "@/lib/launches/list";
import {
  fmtUsd,
  loadProjectFxRates,
  resolveLaunchFallbackRate,
} from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Lanzamientos · Portal" };

/**
 * Lista de lanzamientos para el cliente — vista plana de tabla.
 * Sin botones de crear/editar/borrar (cliente_role no tiene grant write).
 * Mismo cálculo de KPI por fila que la versión del equipo, con conversión FX
 * a USD (launch rate → mensual `project_fx_rates` como fallback). `banks` y
 * `payment_methods` van vacíos porque cliente_role no tiene grant sobre esas
 * tablas (frontera org-scope de 0101); `sale.currency` + `payment.original_
 * currency` alcanzan porque están backfilleados (0104/0106).
 */
export default async function ClientLaunchesPage({
  params,
}: {
  readonly params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const supabase = await createClient();
  const [launches, adsAggregates, kanbanSalesAggregates, fxMap] =
    await Promise.all([
      listLaunchesForProject(projectId),
      listAggregatesForProject(projectId),
      getKanbanSalesAggregatesForProject(projectId),
      loadProjectFxRates(supabase, projectId),
    ]);

  const launchesForFx = launches.map((l) => {
    const row = l as unknown as {
      ars_per_usd?: number | null;
      date_start?: string | null;
      date_end?: string | null;
    };
    return {
      id: l.id,
      ars_per_usd: row.ars_per_usd ?? null,
      date_start: row.date_start ?? null,
      date_end: row.date_end ?? null,
    };
  });
  const revenueUsdMap = await getProjectRevenueUsdMap(
    projectId,
    launchesForFx,
    fxMap,
    [],
    [],
  );

  if (launches.length === 0) {
    return (
      <section className="max-w-md space-y-4">
        <h1 className="text-2xl font-bold">Lanzamientos</h1>
        <p className="text-sm text-fg-muted">
          Aún no hay lanzamientos cargados en este proyecto.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Lanzamientos</h1>
        <p className="mt-1 text-xs text-fg-subtle">{launches.length} total</p>
      </header>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-surface text-left text-xs uppercase tracking-wide text-fg-subtle">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">
                Nombre
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Fecha
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Status
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                Revenue
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                ROAS
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                Profit
              </th>
            </tr>
          </thead>
          <tbody>
            {launches.map((l) => {
              const launchRow = l as unknown as {
                ars_per_usd?: number | null;
                ads_currency?: string;
                date_start?: string | null;
                date_end?: string | null;
              };
              const revenueRate = resolveLaunchFallbackRate(launchRow, fxMap);
              const usdRevenue = revenueUsdMap.get(l.id);
              const kpi = calculateLaunchKPIs(l, {
                adsAggregate: adsAggregates.get(l.id),
                kanbanSalesAggregate: kanbanSalesAggregates.get(l.id),
                adsRatePerUsd:
                  launchRow.ads_currency === "ARS" && revenueRate
                    ? revenueRate
                    : null,
                kanbanPledgedUsd: usdRevenue?.pledgedUsd ?? null,
                kanbanCollectedUsd: usdRevenue?.collectedUsd ?? null,
                revenueRatePerUsd: revenueRate,
              });
              const profitColor =
                kpi.profitEstimated > 0
                  ? "text-success"
                  : kpi.profitEstimated < 0
                    ? "text-error"
                    : "text-fg";
              return (
                <tr
                  key={l.id}
                  className="border-t border-border transition-colors hover:bg-bg-elevated"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/portal/proyectos/${projectId}/launches/${l.id}`}
                      className="font-medium text-fg hover:text-accent"
                    >
                      {l.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-xs text-fg-subtle">
                    {fmtLaunchWindow(l.date_start, l.date_end)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={l.status} />
                  </td>
                  <td className="px-4 py-3 text-right font-medium">
                    {fmtUsd(kpi.revenueEstimated)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {fmtMultiplier(kpi.roasEstimated)}
                  </td>
                  <td className={`px-4 py-3 text-right font-medium ${profitColor}`}>
                    {fmtUsd(kpi.profitEstimated)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
