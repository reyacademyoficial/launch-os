/**
 * Pure KPI math, ported from the legacy prototype (`docs/legacy/App.jsx`).
 *
 * Input shape mirrors the DB `launches` row (snake_case) so rows from Supabase
 * can be passed in directly. Output is camelCase because it's read by UI code.
 *
 * All helpers are safe against NaN / Infinity / division-by-zero so partial
 * input never crashes the dashboard.
 *
 * Fuente de los campos por canal de ads (meta/google/tiktok inv + leads +
 * clicks): si el caller pasa `opts.adsAggregate` y tiene `daysCovered > 0`,
 * todo el bloque de ads sale del agregado (que ya resolvió manual vs API por
 * día). Si no, fallback a las columnas estáticas de `launches.*` cargadas a
 * mano — compat con launches del prototipo viejo que nunca tuvieron daily.
 * NUNCA se mezclan agregado y columna estática: o uno o el otro.
 *
 * Fuente del revenue (Phase 9):
 *   - Modelo aditivo: kanban (sales+payments en columna `cerrado`) + manual.
 *     Las dos fuentes SE SUMAN siempre. Si no hay kanban, el KPI = solo
 *     manual; si no hay manual, = solo kanban; si hay las dos, = suma.
 *   - GHL opportunities ya NO entran al cálculo (Phase 9, decisión 2.a).
 *     El sync sigue guardando filas pero `kpis.ts` no las lee más.
 *   - Dos métricas separadas: `revenueEstimated` (pactado) y
 *     `revenueCollected` (realmente cobrado). Cada una con su ROAS.
 */

import type { KanbanSalesAggregate } from "./launch-sales/aggregate";
import type { CommunityAggregate } from "./launch-community/aggregate";
import type { DailyAggregate } from "./launch-daily/aggregate";

export const safeNumber = (v: unknown, fallback = 0): number => {
  const n = typeof v === "number" ? v : parseFloat(v as string);
  return Number.isFinite(n) ? n : fallback;
};

export const safeInt = (v: unknown, fallback = 0): number => {
  const n = typeof v === "number" ? Math.trunc(v) : parseInt(v as string, 10);
  return Number.isFinite(n) ? n : fallback;
};

export const safeDiv = (a: unknown, b: unknown, fallback = 0): number => {
  const nb = safeNumber(b);
  return nb !== 0 ? safeNumber(a) / nb : fallback;
};

export const safePercent = (a: unknown, b: unknown): number => safeDiv(a, b) * 100;

export interface LaunchKPIInput {
  meta_investment?: number | string | null;
  meta_leads?: number | string | null;
  google_investment?: number | string | null;
  google_leads?: number | string | null;
  tiktok_investment?: number | string | null;
  tiktok_leads?: number | string | null;
  contactos_api?: number | string | null;
  ingresos_whatsapp?: number | string | null;
  registrados?: number | string | null;
  asistentes?: number | string | null;
  hasta_pitch?: number | string | null;
  ventas_total?: number | string | null;
  revenue_estimated_manual?: number | string | null;
  revenue_collected_manual?: number | string | null;
}

export interface LaunchKPIOptions {
  /**
   * Totales por canal derivados de `launch_daily ∪ launch_daily_ads`. Cuando
   * `daysCovered > 0`, los campos de ads (metaInv/metaLeads/google/tiktok)
   * salen de acá y el campo estático del launch se ignora. Cuando no, fallback
   * al estático.
   */
  adsAggregate?: DailyAggregate;
  /**
   * Agregado del kanban: ventas en columna `cerrado` del launch + payments
   * de esas ventas. Modo aditivo (decisión 3.b — Phase 9): siempre se suma
   * a los campos manuales `revenue_estimated_manual` / `revenue_collected_manual`
   * / `ventas_total`. `hasData=true` cuando hay al menos 1 venta cerrada;
   * la UI lo usa solo para mostrar/ocultar el bloque "incluye X ventas del
   * kanban", no para decidir la fuente del número.
   */
  kanbanSalesAggregate?: KanbanSalesAggregate;
  /**
   * Agregado de `launch_community_metrics` (SendFlow). Cuando `hasData=true`,
   * derivamos los KPIs de comunidad (% retención + % que entró). Si no, los
   * KPIs salen `null` — la UI muestra "—" porque no hay valor manual de
   * fallback para comunidad.
   */
  communityAggregate?: CommunityAggregate;
}

export interface LaunchKPIs {
  metaInv: number;
  metaLeads: number;
  googleInv: number;
  googleLeads: number;
  tiktokInv: number;
  tiktokLeads: number;
  contactosAPI: number;
  whatsappRevenue: number;
  /**
   * Alias de `revenueEstimated` para consumers viejos (PDF, IA summary,
   * analytics) que aún no migraron a la distinción estimado/cobrado. Una vez
   * que todos migren, se borra.
   */
  revenue: number;
  /** Σ pactado del kanban (cerrado) + revenue_estimated_manual. */
  revenueEstimated: number;
  /** Σ cobrado del kanban (payments en cerrado) + revenue_collected_manual. */
  revenueCollected: number;
  registrados: number;
  asistentes: number;
  hastaPitch: number;
  /** Σ ventas cerradas del kanban + ventas_total manual. */
  ventas: number;
  totalLeads: number;
  totalInvestment: number;
  cplMeta: number;
  cplGoogle: number;
  cplTiktok: number;
  whatsappRevenueShare: number;
  /** Alias de `roasEstimated` para compat. */
  roas: number;
  /** revenueEstimated / totalInvestment. Lo que pactaron, sobre lo invertido. */
  roasEstimated: number;
  /** revenueCollected / totalInvestment. Lo que cobraron, sobre lo invertido. */
  roasReal: number;
  cac: number;
  showRate: number;
  closeRate: number;
  /** Alias de `profitEstimated` para compat con dashboards viejos. */
  profit: number;
  /** revenueEstimated - totalInvestment. */
  profitEstimated: number;
  /** revenueCollected - totalInvestment. */
  profitReal: number;
  /** Counts crudos de comunidad WhatsApp (SendFlow). 0 si no hay sync. */
  enteredCommunity: number;
  leftCommunity: number;
  communityClicks: number;
  /**
   * Porcentaje 0–100. `((entered - removed) / entered) * 100`. `null` cuando
   * entered = 0 (sin base para calcular retención). UI muestra "—".
   * Consistente con showRate / closeRate / whatsappRevenueShare que también
   * son 0–100, no 0–1.
   */
  retentionRate: number | null;
  /**
   * Porcentaje 0–100. `(entered / totalLeads) * 100`. `null` cuando
   * totalLeads = 0 o cuando communityAggregate.hasData = false.
   */
  enteredCommunityRate: number | null;
}

export function calculateLaunchKPIs(
  l: LaunchKPIInput | null | undefined,
  opts: LaunchKPIOptions = {},
): LaunchKPIs {
  if (!l) {
    return {
      metaInv: 0,
      metaLeads: 0,
      googleInv: 0,
      googleLeads: 0,
      tiktokInv: 0,
      tiktokLeads: 0,
      contactosAPI: 0,
      whatsappRevenue: 0,
      revenue: 0,
      revenueEstimated: 0,
      revenueCollected: 0,
      registrados: 0,
      asistentes: 0,
      hastaPitch: 0,
      ventas: 0,
      totalLeads: 0,
      totalInvestment: 0,
      cplMeta: 0,
      cplGoogle: 0,
      cplTiktok: 0,
      whatsappRevenueShare: 0,
      roas: 0,
      roasEstimated: 0,
      roasReal: 0,
      cac: 0,
      showRate: 0,
      closeRate: 0,
      profit: 0,
      profitEstimated: 0,
      profitReal: 0,
      enteredCommunity: 0,
      leftCommunity: 0,
      communityClicks: 0,
      retentionRate: null,
      enteredCommunityRate: null,
    };
  }

  // Si hay daily real (merge cubre al menos 1 día), los 6 campos de ads
  // salen del agregado. Si no, fallback a las columnas estáticas del launch.
  const useAggregate = (opts.adsAggregate?.daysCovered ?? 0) > 0;
  const agg = opts.adsAggregate;

  const metaInv = useAggregate ? agg!.metaSpend : safeNumber(l.meta_investment);
  const metaLeads = useAggregate ? agg!.metaLeads : safeInt(l.meta_leads);
  const googleInv = useAggregate
    ? agg!.googleSpend
    : safeNumber(l.google_investment);
  const googleLeads = useAggregate ? agg!.googleLeads : safeInt(l.google_leads);
  const tiktokInv = useAggregate
    ? agg!.tiktokSpend
    : safeNumber(l.tiktok_investment);
  const tiktokLeads = useAggregate ? agg!.tiktokLeads : safeInt(l.tiktok_leads);
  const contactosAPI = safeInt(l.contactos_api);
  const whatsappRevenue = safeNumber(l.ingresos_whatsapp);

  // Revenue: modelo aditivo kanban + manual (Phase 9, decisión 3.b).
  // Si no hay kanbanSalesAggregate, kanbanPledged/Collected/Count = 0 → solo
  // pesa el manual. Mismo patrón para `ventas`.
  const kanban = opts.kanbanSalesAggregate;
  const kanbanPledged = kanban?.pledgedRevenue ?? 0;
  const kanbanCollected = kanban?.collectedRevenue ?? 0;
  const kanbanSalesCount = kanban?.salesCount ?? 0;

  const revenueEstimated =
    kanbanPledged + safeNumber(l.revenue_estimated_manual);
  const revenueCollected =
    kanbanCollected + safeNumber(l.revenue_collected_manual);
  const ventas = kanbanSalesCount + safeInt(l.ventas_total);

  const registrados = safeInt(l.registrados);
  const asistentes = safeInt(l.asistentes);
  const hastaPitch = safeInt(l.hasta_pitch);

  const totalLeads = metaLeads + googleLeads + tiktokLeads;
  const totalInvestment = metaInv + googleInv + tiktokInv;

  // Comunidad (SendFlow). Si no hay sync escrito, queda en 0 y los rates
  // en null (UI muestra "—"). Misma regla simétrica que ads/ventas pero sin
  // fallback manual — comunidad no tiene columna estática en `launches`.
  const community = opts.communityAggregate;
  const enteredCommunity = community?.entered ?? 0;
  const leftCommunity = community?.removed ?? 0;
  const communityClicks = community?.clicks ?? 0;
  const retentionRate =
    enteredCommunity > 0
      ? ((enteredCommunity - leftCommunity) / enteredCommunity) * 100
      : null;
  const enteredCommunityRate =
    totalLeads > 0 && community?.hasData
      ? (enteredCommunity / totalLeads) * 100
      : null;

  const roasEstimated = safeDiv(revenueEstimated, totalInvestment);
  const roasReal = safeDiv(revenueCollected, totalInvestment);
  const profitEstimated = revenueEstimated - totalInvestment;
  const profitReal = revenueCollected - totalInvestment;

  return {
    metaInv,
    metaLeads,
    googleInv,
    googleLeads,
    tiktokInv,
    tiktokLeads,
    contactosAPI,
    whatsappRevenue,
    revenue: revenueEstimated,
    revenueEstimated,
    revenueCollected,
    registrados,
    asistentes,
    hastaPitch,
    ventas,
    totalLeads,
    totalInvestment,
    cplMeta: safeDiv(metaInv, metaLeads),
    cplGoogle: safeDiv(googleInv, googleLeads),
    cplTiktok: safeDiv(tiktokInv, tiktokLeads),
    whatsappRevenueShare: safePercent(whatsappRevenue, revenueEstimated),
    roas: roasEstimated,
    roasEstimated,
    roasReal,
    cac: safeDiv(totalInvestment, ventas),
    showRate: safePercent(asistentes, registrados),
    closeRate: safePercent(ventas, asistentes),
    profit: profitEstimated,
    profitEstimated,
    profitReal,
    enteredCommunity,
    leftCommunity,
    communityClicks,
    retentionRate,
    enteredCommunityRate,
  };
}
