/**
 * Agregado puro de `launch_opportunities` para los KPIs `ventas_total` y
 * `revenue`. Mismo patrón que `aggregateMergedDaily` en launch-daily/aggregate:
 * función pura, sin acceso a DB, testeable contra fixtures.
 *
 * Regla de ventana (decisión 2.a, ver INTEGRATIONS_GHL.md): una opp cuenta
 * solo si `status='won'` y `won_at` cae en `[launch.date_start,
 * launch.date_end]`. Las opps abiertas, perdidas o ganadas fuera de la
 * ventana se ignoran para los KPIs de este launch — quedan en DB como
 * histórico para auditoría o agregados futuros.
 *
 * Regla de fallback (decisión 3, simétrica con `adsAggregate.daysCovered`):
 *   - `hasData = rows.length > 0` → el caller usa este agregado y descarta
 *     `launches.ventas_total` / `launches.revenue`.
 *   - `hasData = false` → el caller usa los valores manuales del form.
 *   - NUNCA se mezclan agregado y valor manual.
 *
 * Una location con GHL configurada pero sin Opportunities activas mantiene
 * `hasData = false` (tabla vacía) y los KPIs siguen leyendo el form manual.
 * En el momento en que el cliente crea su primera opp en GHL y sincroniza,
 * el KPI bascula automáticamente a la fuente del sync.
 */

export interface LaunchOpportunityRow {
  status: "open" | "won" | "lost" | "abandoned";
  /** Decimal (puede tener centavos). Null = no monetary asignado en GHL. */
  monetary_value: number | string | null;
  /** ISO timestamp del cambio a status=won. Null si la opp nunca llegó a won. */
  won_at: string | null;
}

export interface LaunchWindow {
  /** YYYY-MM-DD inclusivo. */
  date_start: string;
  /** YYYY-MM-DD inclusivo (hasta fin del día UTC). */
  date_end: string;
}

export interface SalesAggregate {
  /**
   * True si hay al menos 1 fila en `launch_opportunities` para este launch
   * (independiente de status o ventana). Sirve de signal "el sync trajo
   * data, no uses fallback manual".
   */
  hasData: boolean;
  /** Cantidad de opps con status='won' Y won_at en la ventana del launch. */
  wonCount: number;
  /** Suma de monetary_value de las wonCount. NULL se interpreta como 0. */
  wonRevenue: number;
}

export const EMPTY_SALES_AGGREGATE: SalesAggregate = {
  hasData: false,
  wonCount: 0,
  wonRevenue: 0,
};

export function aggregateOpportunities(
  rows: ReadonlyArray<LaunchOpportunityRow>,
  window: LaunchWindow,
): SalesAggregate {
  if (rows.length === 0) return EMPTY_SALES_AGGREGATE;

  const startMs = Date.parse(`${window.date_start}T00:00:00.000Z`);
  const endMs = Date.parse(`${window.date_end}T23:59:59.999Z`);

  let wonCount = 0;
  let wonRevenue = 0;

  for (const r of rows) {
    if (r.status !== "won") continue;
    if (!r.won_at) continue;
    const ms = Date.parse(r.won_at);
    if (!Number.isFinite(ms)) continue;
    if (ms < startMs || ms > endMs) continue;

    wonCount++;
    const v =
      typeof r.monetary_value === "number"
        ? r.monetary_value
        : typeof r.monetary_value === "string"
          ? parseFloat(r.monetary_value)
          : NaN;
    if (Number.isFinite(v)) wonRevenue += v;
  }

  return { hasData: true, wonCount, wonRevenue };
}
