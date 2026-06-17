/**
 * Agregado puro de `launch_community_metrics` para los KPIs de comunidad
 * (% retención + % que entró a la comunidad). Mismo patrón que
 * `aggregateOpportunities` / `aggregateMergedDaily`: función pura, sin DB.
 *
 * El sync ya escribió una fila por (launch, provider, ventana) con
 * `entered/removed/clicks` SUMADOS de todas las releases del lanzamiento
 * y acotados a la ventana. Acá solo elegimos la fila correcta y mapeamos.
 *
 * Si hay múltiples filas (caso edge: el launch reabrió y cambió la ventana,
 * dejando una fila vieja con otra ventana + una nueva), tomamos la de
 * `synced_at` más reciente. En operación normal hay 1 sola fila.
 *
 * Regla de fallback (simétrica con `salesAggregate.hasData`):
 *   - `hasData = entered > 0` → el caller deriva los KPIs de esta fuente.
 *   - `hasData = false` → no hay nada que mostrar; la UI tapa los KPIs
 *     o muestra "—".
 *   - NO hay valor manual de fallback para comunidad (a diferencia de ads/
 *     ventas) — si no hay sync, no hay métrica.
 */

export interface LaunchCommunityRow {
  /** Sumatoria de los entered del sync (entered de SendFlow). */
  entered: number | string | null;
  removed: number | string | null;
  clicks: number | string | null;
  synced_at: string | null;
}

export interface CommunityAggregate {
  /** True si entered > 0 → hay actividad de comunidad para derivar KPIs. */
  hasData: boolean;
  entered: number;
  removed: number;
  clicks: number;
}

export const EMPTY_COMMUNITY_AGGREGATE: CommunityAggregate = {
  hasData: false,
  entered: 0,
  removed: 0,
  clicks: 0,
};

function toInt(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? Math.trunc(v) : 0;
  if (typeof v === "string") {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * Toma N filas (en la práctica 0 o 1) y elige la más reciente por `synced_at`.
 * Devuelve un agregado con los 3 contadores + flag hasData.
 */
export function aggregateCommunityMetrics(
  rows: ReadonlyArray<LaunchCommunityRow>,
): CommunityAggregate {
  if (rows.length === 0) return EMPTY_COMMUNITY_AGGREGATE;

  let latest = rows[0]!;
  let latestMs = Date.parse(latest.synced_at ?? "");
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]!;
    const ms = Date.parse(r.synced_at ?? "");
    if (Number.isFinite(ms) && (!Number.isFinite(latestMs) || ms > latestMs)) {
      latest = r;
      latestMs = ms;
    }
  }

  const entered = toInt(latest.entered);
  const removed = toInt(latest.removed);
  const clicks = toInt(latest.clicks);

  return {
    hasData: entered > 0,
    entered,
    removed,
    clicks,
  };
}
