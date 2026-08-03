import { safeDiv, safePercent } from "@/lib/kpis";
import type { DailyAggregate } from "@/lib/launch-daily/aggregate";
import type { KanbanSalesAggregate } from "@/lib/launch-sales/aggregate";
import type { LaunchRow } from "@/lib/launches/types";

/**
 * Project-level aggregates rolled up across all launches.
 *
 * Sums the raw fields (revenue, investment, leads, ventas, etc.) and derives
 * the rate-style KPIs from the totals — never average-of-ratios, which would
 * double-count differently-sized launches.
 *
 * Para los campos de ads (inversión + leads por canal), aplicamos la misma
 * regla que `calculateLaunchKPIs`: si el launch tiene daily (manual o API,
 * `daysCovered > 0`), sale del agregado; si no, fallback a las columnas
 * estáticas `launches.meta_investment` / `meta_leads` / etc. Por launch, una
 * fuente o la otra — nunca mezcladas.
 *
 * Para revenue + ventas (Phase 9): modelo aditivo kanban + manual. Las dos
 * fuentes se SUMAN siempre, simétrico con `calculateLaunchKPIs`. Se exponen
 * `totalRevenueEstimated` y `totalRevenueCollected` por separado + sus ROAS.
 */
export interface ProjectAggregates {
  launchCount: number;
  activeCount: number;
  finalizedCount: number;
  /** Alias de totalRevenueEstimated para callers viejos. */
  totalRevenue: number;
  totalRevenueEstimated: number;
  totalRevenueCollected: number;
  totalInvestment: number;
  /** Alias de totalProfitEstimated. */
  totalProfit: number;
  totalProfitEstimated: number;
  totalProfitReal: number;
  /** Alias de aggregateROASEstimated. */
  aggregateROAS: number;
  aggregateROASEstimated: number;
  aggregateROASReal: number;
  aggregateCAC: number;
  totalLeads: number;
  totalVentas: number;
  totalRegistrados: number;
  totalAsistentes: number;
  aggregateShowRate: number;
  aggregateCloseRate: number;
}

export function aggregateProjectKPIs(
  launches: readonly LaunchRow[],
  aggregatesByLaunch?: ReadonlyMap<string, DailyAggregate>,
  kanbanSalesByLaunch?: ReadonlyMap<string, KanbanSalesAggregate>,
  revenueUsdByLaunch?: ReadonlyMap<
    string,
    { pledgedUsd: number; collectedUsd: number }
  >,
  /**
   * Tasa efectiva por launch (propia o fallback a mensual). Se usa para
   * convertir revenue manual y ads cuando `ads_currency='ARS'`. Si el caller
   * no la pasa, cae a `launch.ars_per_usd` — comportamiento legacy.
   */
  effectiveRateByLaunch?: ReadonlyMap<string, number | null>,
): ProjectAggregates {
  let revenueEstimated = 0;
  let revenueCollected = 0;
  let investment = 0;
  let leads = 0;
  let ventas = 0;
  let registrados = 0;
  let asistentes = 0;
  let active = 0;
  let finalized = 0;

  for (const l of launches) {
    const launchRow = l as unknown as {
      ars_per_usd?: number | null;
      ads_currency?: string;
    };
    const legacyRate =
      launchRow.ars_per_usd && launchRow.ars_per_usd > 0
        ? launchRow.ars_per_usd
        : null;
    const revenueRate = effectiveRateByLaunch?.get(l.id) ?? legacyRate;
    const adsRate =
      launchRow.ads_currency === "ARS" && revenueRate ? revenueRate : null;

    // Revenue: si hay USD pre-calculado usa eso; si no, raw legacy.
    const usdRevenue = revenueUsdByLaunch?.get(l.id);
    if (usdRevenue && revenueRate) {
      const manualPledged =
        (Number(l.revenue_estimated_manual) || 0) / revenueRate;
      const manualCollected =
        (Number(l.revenue_collected_manual) || 0) / revenueRate;
      revenueEstimated += usdRevenue.pledgedUsd + manualPledged;
      revenueCollected += usdRevenue.collectedUsd + manualCollected;
    } else {
      const kanban = kanbanSalesByLaunch?.get(l.id);
      revenueEstimated +=
        (kanban?.pledgedRevenue ?? 0) + (Number(l.revenue_estimated_manual) || 0);
      revenueCollected +=
        (kanban?.collectedRevenue ?? 0) + (Number(l.revenue_collected_manual) || 0);
    }

    ventas +=
      (kanbanSalesByLaunch?.get(l.id)?.salesCount ?? 0) + (l.ventas_total ?? 0);

    const adsAgg = aggregatesByLaunch?.get(l.id);
    const useAggregate = (adsAgg?.daysCovered ?? 0) > 0;

    if (useAggregate) {
      const rawInv =
        adsAgg!.metaSpend + adsAgg!.googleSpend + adsAgg!.tiktokSpend;
      investment += adsRate ? rawInv / adsRate : rawInv;
      leads += adsAgg!.metaLeads + adsAgg!.googleLeads + adsAgg!.tiktokLeads;
    } else {
      const rawInv =
        (Number(l.meta_investment) || 0) +
        (Number(l.google_investment) || 0) +
        (Number(l.tiktok_investment) || 0);
      investment += adsRate ? rawInv / adsRate : rawInv;
      leads +=
        (l.meta_leads ?? 0) + (l.google_leads ?? 0) + (l.tiktok_leads ?? 0);
    }

    registrados += l.registrados ?? 0;
    asistentes += l.asistentes ?? 0;
    if (l.status === "Activo") active++;
    if (l.status === "Finalizado") finalized++;
  }

  return {
    launchCount: launches.length,
    activeCount: active,
    finalizedCount: finalized,
    totalRevenue: revenueEstimated,
    totalRevenueEstimated: revenueEstimated,
    totalRevenueCollected: revenueCollected,
    totalInvestment: investment,
    totalProfit: revenueEstimated - investment,
    totalProfitEstimated: revenueEstimated - investment,
    totalProfitReal: revenueCollected - investment,
    aggregateROAS: safeDiv(revenueEstimated, investment),
    aggregateROASEstimated: safeDiv(revenueEstimated, investment),
    aggregateROASReal: safeDiv(revenueCollected, investment),
    aggregateCAC: safeDiv(investment, ventas),
    totalLeads: leads,
    totalVentas: ventas,
    totalRegistrados: registrados,
    totalAsistentes: asistentes,
    aggregateShowRate: safePercent(asistentes, registrados),
    aggregateCloseRate: safePercent(ventas, asistentes),
  };
}
