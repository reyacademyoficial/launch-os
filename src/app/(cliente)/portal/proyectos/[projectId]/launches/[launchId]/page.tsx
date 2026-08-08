import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  DailyChart,
  type DailyChartRow,
} from "@/components/dashboard/launches/daily/daily-chart";
import { KpiGrid } from "@/components/dashboard/launches/kpi-grid";
import { StatusBadge } from "@/components/dashboard/launches/status-badge";
import { fmtLaunchWindow } from "@/lib/format";
import { calculateLaunchKPIs } from "@/lib/kpis";
import { listSendflowDailyForLaunch } from "@/lib/launch-community/daily";
import { aggregateMergedDaily } from "@/lib/launch-daily/aggregate";
import { listAdsForLaunch, listDailyForLaunch } from "@/lib/launch-daily/list";
import { mergeDailyData } from "@/lib/launch-daily/merge";
import {
  getKanbanSalesAggregateForLaunch,
  getProjectRevenueUsdMap,
} from "@/lib/launch-sales/list";
import { getLaunch } from "@/lib/launches/get";
import { listMessagesDailyForLaunch } from "@/lib/launch-messages/list";
import {
  loadProjectFxRates,
  resolveLaunchFallbackRate,
} from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Lanzamiento · Portal" };

/**
 * Detalle ejecutivo del launch para el cliente.
 *
 * Plano: KPIs + chart de leads por día. Sin tabs de integraciones, IA,
 * calendario o equipo. La carga de datos diarios y la edición tampoco
 * aparecen — el cliente solo mira.
 *
 * Revenue en USD: convertimos con tasa del launch → tasa mensual del mes de
 * `closed_at`/`paid_at` como fallback. `banks` y `payment_methods` van vacíos
 * porque cliente_role no tiene grant sobre esas tablas (frontera org-scope de
 * 0101); `sales.currency` + `payments.original_currency` alcanzan (0104/0106).
 */
export default async function ClientLaunchPage({
  params,
}: {
  readonly params: Promise<{ projectId: string; launchId: string }>;
}) {
  const { projectId, launchId } = await params;

  const supabase = await createClient();
  const [
    launch,
    daily,
    ads,
    kanbanSalesAggregate,
    sendflowDaily,
    messagesDaily,
    fxMap,
  ] = await Promise.all([
    getLaunch(launchId),
    listDailyForLaunch(launchId),
    listAdsForLaunch(launchId),
    getKanbanSalesAggregateForLaunch(projectId, launchId),
    listSendflowDailyForLaunch(launchId),
    listMessagesDailyForLaunch(launchId),
    loadProjectFxRates(supabase, projectId),
  ]);

  if (!launch || launch.project_id !== projectId) notFound();

  const mergedDaily = mergeDailyData(daily, ads);
  const adsAggregate =
    mergedDaily.length > 0 ? aggregateMergedDaily(mergedDaily) : undefined;

  const launchRow = launch as unknown as {
    ars_per_usd?: number | null;
    ads_currency?: string;
    date_start?: string | null;
    date_end?: string | null;
  };
  const revenueRate = resolveLaunchFallbackRate(launchRow, fxMap);
  const usdMap = await getProjectRevenueUsdMap(
    projectId,
    [
      {
        id: launch.id,
        ars_per_usd: launchRow.ars_per_usd ?? null,
        date_start: launchRow.date_start ?? null,
        date_end: launchRow.date_end ?? null,
      },
    ],
    fxMap,
    [],
    [],
  );
  const usdRevenue = usdMap.get(launch.id);

  const kpi = calculateLaunchKPIs(launch, {
    adsAggregate,
    kanbanSalesAggregate,
    adsRatePerUsd:
      launchRow.ads_currency === "ARS" && revenueRate ? revenueRate : null,
    kanbanPledgedUsd: usdRevenue?.pledgedUsd ?? null,
    kanbanCollectedUsd: usdRevenue?.collectedUsd ?? null,
    revenueRatePerUsd: revenueRate,
  });

  // Portal cliente: misma overlay del chart que el dashboard interno (Fase B).
  // No mostramos `overlayPartialNote` porque el cliente no necesita saber del
  // status del sync — solo ve la curva tal cual quedó.
  const chartRows = buildClientOverlayRows({
    merged: mergedDaily,
    sendflow: sendflowDaily.rows,
    messages: messagesDaily,
  });

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

      <KpiGrid
        kpi={kpi}
        launchArsPerUsd={launchRow.ars_per_usd ?? null}
        kpisInUsd={revenueRate !== null}
      />

      {chartRows.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-fg">Evolución diaria</h2>
          <p className="text-xs text-fg-subtle">
            Leads por canal a lo largo del lanzamiento.
          </p>
          <DailyChart rows={chartRows} />
        </section>
      )}
    </section>
  );
}

/**
 * Merge de las 3 fuentes (canales + SendFlow + GHL messages) por fecha para
 * el chart del cliente portal. Mismo shape que el helper del dashboard
 * interno; vive acá para que la page sea autocontenida (no compartimos por
 * ahora — si se duplica una 3ra vez, refactor a util).
 */
function buildClientOverlayRows(args: {
  readonly merged: ReadonlyArray<{
    readonly date: string;
    readonly meta_ads: number;
    readonly google_ads: number;
    readonly tiktok_ads: number;
    readonly organico: number;
    readonly whatsapp: number;
    readonly referidos: number;
    readonly otro: number;
  }>;
  readonly sendflow: ReadonlyArray<{ readonly date: string; readonly entered: number }>;
  readonly messages: ReadonlyArray<{
    readonly date: string;
    readonly inboundCount: number;
  }>;
}): DailyChartRow[] {
  const byDate = new Map<string, DailyChartRow>();
  for (const r of args.merged) {
    byDate.set(r.date, {
      date: r.date,
      meta_ads: r.meta_ads,
      google_ads: r.google_ads,
      tiktok_ads: r.tiktok_ads,
      organico: r.organico,
      whatsapp: r.whatsapp,
      referidos: r.referidos,
      otro: r.otro,
      sendflow_add: 0,
      ghl_inbound: 0,
    });
  }
  const ensure = (date: string): DailyChartRow => {
    const existing = byDate.get(date);
    if (existing) return existing;
    const fresh: DailyChartRow = {
      date,
      meta_ads: 0,
      google_ads: 0,
      tiktok_ads: 0,
      organico: 0,
      whatsapp: 0,
      referidos: 0,
      otro: 0,
      sendflow_add: 0,
      ghl_inbound: 0,
    };
    byDate.set(date, fresh);
    return fresh;
  };
  for (const s of args.sendflow) {
    ensure(s.date).sendflow_add = s.entered;
  }
  for (const m of args.messages) {
    ensure(m.date).ghl_inbound = m.inboundCount;
  }
  return Array.from(byDate.values()).sort((a, b) =>
    a.date.localeCompare(b.date),
  );
}
