import type { Metadata } from "next";
import Link from "next/link";

import { LaunchFormModal } from "@/components/dashboard/launches/launch-form-modal";
import { StatusBadge } from "@/components/dashboard/launches/status-badge";
import { fmtLaunchWindow, fmtMoney, fmtMultiplier } from "@/lib/format";
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
import { listBanks } from "@/lib/banks/list";
import { listPaymentMethods } from "@/lib/payment-methods/list";
import { requireSessionProfile, userCanEditLaunchesIn } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

import { createLaunch } from "./actions";

export const metadata: Metadata = { title: "Lanzamientos" };

export default async function LaunchesPage({
  params,
}: {
  readonly params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const supabase = await createClient();
  const [
    profile,
    launches,
    canEdit,
    adsAggregates,
    kanbanSalesAggregates,
    paymentMethods,
    banks,
    fxMap,
  ] = await Promise.all([
    requireSessionProfile(),
    listLaunchesForProject(projectId),
    userCanEditLaunchesIn(projectId),
    listAggregatesForProject(projectId),
    getKanbanSalesAggregatesForProject(projectId),
    listPaymentMethods(projectId),
    listBanks(),
    loadProjectFxRates(supabase, projectId),
  ]);

  const hideRevenue = profile.role === "operador";

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
    paymentMethods as unknown as Array<{
      id: string;
      bank_id: string | null;
      currency: "ARS" | "USD" | null;
    }>,
    banks as unknown as Array<{ id: string; currency: "ARS" | "USD" }>,
  );

  const createAction = createLaunch.bind(null, projectId);
  // El select "Copiar conexiones de" en el modal de crear listea launches
  // existentes del mismo proyecto. Se reusan los datos que ya pedimos arriba.
  const copyableLaunches = launches.map((l) => ({ id: l.id, name: l.name }));

  if (launches.length === 0) {
    return (
      <section className="max-w-md space-y-4">
        <h1 className="text-2xl font-bold">Lanzamientos</h1>
        <p className="text-sm text-fg-muted">
          Sin lanzamientos cargados todavía
          {canEdit ? "." : ". Pedile al admin del proyecto que cree el primero."}
        </p>
        {canEdit && (
          <LaunchFormModal
            triggerLabel="Crear el primero"
            title="Nuevo lanzamiento"
            submitLabel="Crear lanzamiento"
            action={createAction}
          />
        )}
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Lanzamientos</h1>
          <p className="mt-1 text-xs text-fg-subtle">{launches.length} total</p>
        </div>
        {canEdit && (
          <LaunchFormModal
            triggerLabel="+ Nuevo lanzamiento"
            title="Nuevo lanzamiento"
            submitLabel="Crear lanzamiento"
            action={createAction}
            copyableLaunches={copyableLaunches}
            recycleTargetOptions={copyableLaunches}
          />
        )}
      </header>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[820px] text-sm">
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
              {!hideRevenue && (
                <>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    Revenue est.
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    Revenue cobr.
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    ROAS est.
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    Profit est.
                  </th>
                </>
              )}
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

              // Mostrar en USD si CUALQUIER camino de conversión funcionó:
              // - hay tasa efectiva del launch (propia o monthly), o
              // - el kanban devolvió montos USD válidos (via saleToUsd /
              //   paymentToUsd, que ya aplican fallback interno launch→monthly
              //   y respetan sale.currency='USD' nativo sin necesitar tasa).
              // Antes: `revenueRate ? fmtUsd : fmtMoney` — una venta USD nativa
              // en un launch sin tasa se mostraba como pesos crudos ("500")
              // aunque el kpi.revenueEstimated ya viniera en USD.
              const hasUsdRevenue =
                (usdRevenue?.pledgedUsd ?? 0) > 0 ||
                (usdRevenue?.collectedUsd ?? 0) > 0;
              const fMoney = revenueRate || hasUsdRevenue ? fmtUsd : fmtMoney;
              const profitColor =
                kpi.profitEstimated > 0
                  ? "text-success"
                  : kpi.profitEstimated < 0
                    ? "text-error"
                    : "text-fg";
              return (
                <tr
                  key={l.id}
                  className="border-t border-border transition-colors hover:bg-surface"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/proyectos/${projectId}/launches/${l.id}`}
                      className="font-medium text-fg hover:text-accent"
                    >
                      {l.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-fg-muted">
                    {fmtLaunchWindow(l.date_start, l.date_end)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={l.status} />
                  </td>
                  {!hideRevenue && (
                    <>
                      <td className="px-4 py-3 text-right tabular-nums text-fg">
                        {fMoney(kpi.revenueEstimated)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-fg">
                        {fMoney(kpi.revenueCollected)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-fg-muted">
                        {fmtMultiplier(kpi.roasEstimated)}
                      </td>
                      <td className={`px-4 py-3 text-right tabular-nums ${profitColor}`}>
                        {fMoney(kpi.profitEstimated)}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
