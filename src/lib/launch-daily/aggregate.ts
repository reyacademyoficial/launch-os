import type { MergedDailyRow } from "./merge";

/**
 * Totales por canal derivados de `MergedDailyRow[]` (la salida del merge
 * manual ∪ API). Función pura — el merge ya resolvió la regla "API gana sobre
 * manual" por día y por canal, así que acá solo sumamos.
 *
 * Regla manual vs API (declarada en `merge.ts`, replicada acá para no dejar
 * ambigüedad):
 *   - Canal pago (meta_ads/google_ads/tiktok_ads) en un día dado:
 *     · si hay row en `launch_daily_ads` para ese día → API gana.
 *     · si no hay → fallback al manual de `launch_daily`.
 *     · NUNCA se suma manual + API.
 *   - Métricas exclusivas de API (spend/clicks/impressions): solo API.
 *   - Para los KPIs agregados a nivel launch/proyecto:
 *     · si `daysCovered === 0` (no hay ningún row, ni manual ni API) → el
 *       caller usa el campo estático `launches.meta_investment` /
 *       `meta_leads` / etc. como fallback (compat con launches del prototipo
 *       viejo que nunca tuvieron daily).
 *     · si `daysCovered > 0` → el caller usa solo este agregado y descarta el
 *       campo estático. Nunca se mezclan las dos fuentes.
 */
export interface DailyAggregate {
  metaLeads: number;
  metaSpend: number;
  metaClicks: number;
  metaImpressions: number;
  googleLeads: number;
  googleSpend: number;
  googleClicks: number;
  googleImpressions: number;
  tiktokLeads: number;
  tiktokSpend: number;
  tiktokClicks: number;
  tiktokImpressions: number;
  /** Cantidad de filas en el merge (manual ∪ API). 0 = sin daily, fallback. */
  daysCovered: number;
}

export const EMPTY_DAILY_AGGREGATE: DailyAggregate = {
  metaLeads: 0,
  metaSpend: 0,
  metaClicks: 0,
  metaImpressions: 0,
  googleLeads: 0,
  googleSpend: 0,
  googleClicks: 0,
  googleImpressions: 0,
  tiktokLeads: 0,
  tiktokSpend: 0,
  tiktokClicks: 0,
  tiktokImpressions: 0,
  daysCovered: 0,
};

export function aggregateMergedDaily(
  merged: ReadonlyArray<MergedDailyRow>,
): DailyAggregate {
  if (merged.length === 0) return EMPTY_DAILY_AGGREGATE;

  let metaLeads = 0;
  let metaSpend = 0;
  let metaClicks = 0;
  let metaImpressions = 0;
  let googleLeads = 0;
  let googleSpend = 0;
  let googleClicks = 0;
  let googleImpressions = 0;
  let tiktokLeads = 0;
  let tiktokSpend = 0;
  let tiktokClicks = 0;
  let tiktokImpressions = 0;

  for (const row of merged) {
    metaLeads += row.meta_ads;
    metaSpend += row.meta_spend;
    metaClicks += row.meta_clicks;
    metaImpressions += row.meta_impressions;
    googleLeads += row.google_ads;
    googleSpend += row.google_spend;
    googleClicks += row.google_clicks;
    googleImpressions += row.google_impressions;
    tiktokLeads += row.tiktok_ads;
    tiktokSpend += row.tiktok_spend;
    tiktokClicks += row.tiktok_clicks;
    tiktokImpressions += row.tiktok_impressions;
  }

  return {
    metaLeads,
    metaSpend,
    metaClicks,
    metaImpressions,
    googleLeads,
    googleSpend,
    googleClicks,
    googleImpressions,
    tiktokLeads,
    tiktokSpend,
    tiktokClicks,
    tiktokImpressions,
    daysCovered: merged.length,
  };
}
