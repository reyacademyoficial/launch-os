import type { LaunchRow } from "@/lib/launches/types";

/**
 * Parser puro de los searchParams compartidos por las 4 vistas de analítica.
 * URL state:
 *   - `from` / `to` → YYYY-MM-DD, recorta launches por `date_start` (un
 *     launch sin date_start cae fuera si hay rango activo).
 *   - `launches`    → CSV de uuids; vacío = todos los del proyecto.
 *
 * `applyFilter` devuelve el subset filtrado de launches en el mismo orden
 * (date_start desc) que vienen de `listLaunchesForProject`.
 */

export interface AnalyticsFilter {
  dateFrom: string | null;
  dateTo: string | null;
  launchIds: ReadonlySet<string> | null;
}

export function parseAnalyticsFilter(
  sp: Record<string, string | string[] | undefined>,
): AnalyticsFilter {
  const dateFrom = pickString(sp.from);
  const dateTo = pickString(sp.to);
  const launchesParam = pickString(sp.launches);
  const launchIds = launchesParam
    ? new Set(
        launchesParam
          .split(",")
          .map((s) => s.trim())
          .filter((s) => /^[0-9a-f-]{36}$/i.test(s)),
      )
    : null;

  return {
    dateFrom: dateFrom || null,
    dateTo: dateTo || null,
    launchIds: launchIds && launchIds.size > 0 ? launchIds : null,
  };
}

export function applyAnalyticsFilter(
  launches: readonly LaunchRow[],
  filter: AnalyticsFilter,
): LaunchRow[] {
  return launches.filter((l) => {
    if (filter.launchIds && !filter.launchIds.has(l.id)) return false;
    if (filter.dateFrom || filter.dateTo) {
      if (!l.date_start) return false;
      if (filter.dateFrom && l.date_start < filter.dateFrom) return false;
      if (filter.dateTo && l.date_start > filter.dateTo) return false;
    }
    return true;
  });
}

function pickString(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0] ?? "";
  return v ?? "";
}
