import { safeDiv, safePercent } from "@/lib/kpis";
import type { LaunchRow } from "@/lib/launches/types";

/**
 * Project-level aggregates rolled up across all launches.
 *
 * Sums the raw fields (revenue, investment, leads, ventas, etc.) and derives
 * the rate-style KPIs from the totals — never average-of-ratios, which would
 * double-count differently-sized launches.
 */
export interface ProjectAggregates {
  launchCount: number;
  activeCount: number;
  finalizedCount: number;
  totalRevenue: number;
  totalInvestment: number;
  totalProfit: number;
  aggregateROAS: number;
  aggregateCAC: number;
  totalLeads: number;
  totalVentas: number;
  totalRegistrados: number;
  totalAsistentes: number;
  aggregateShowRate: number;
  aggregateCloseRate: number;
}

export function aggregateProjectKPIs(launches: readonly LaunchRow[]): ProjectAggregates {
  let revenue = 0;
  let investment = 0;
  let leads = 0;
  let ventas = 0;
  let registrados = 0;
  let asistentes = 0;
  let active = 0;
  let finalized = 0;

  for (const l of launches) {
    revenue += Number(l.revenue) || 0;
    investment +=
      (Number(l.meta_investment) || 0) +
      (Number(l.google_investment) || 0) +
      (Number(l.tiktok_investment) || 0);
    leads += (l.meta_leads ?? 0) + (l.google_leads ?? 0) + (l.tiktok_leads ?? 0);
    ventas += l.ventas_total ?? 0;
    registrados += l.registrados ?? 0;
    asistentes += l.asistentes ?? 0;
    if (l.status === "Activo") active++;
    if (l.status === "Finalizado") finalized++;
  }

  return {
    launchCount: launches.length,
    activeCount: active,
    finalizedCount: finalized,
    totalRevenue: revenue,
    totalInvestment: investment,
    totalProfit: revenue - investment,
    aggregateROAS: safeDiv(revenue, investment),
    aggregateCAC: safeDiv(investment, ventas),
    totalLeads: leads,
    totalVentas: ventas,
    totalRegistrados: registrados,
    totalAsistentes: asistentes,
    aggregateShowRate: safePercent(asistentes, registrados),
    aggregateCloseRate: safePercent(ventas, asistentes),
  };
}
