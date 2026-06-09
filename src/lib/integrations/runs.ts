import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * Derivación del estado de integración a partir de `integration_runs`.
 *
 * No mantenemos una tabla `launch_integrations` aparte: el "estado actual"
 * (último status, último sync exitoso, hay errores activos) sale siempre del
 * log de runs. Una sola fuente de verdad, sin races cuando el sync corre y
 * la UI rerenderiza al mismo tiempo.
 *
 * Read-only por diseño — los inserts/updates en `integration_runs` los hace
 * el orchestrator vía service-role.
 */

export interface IntegrationStatusForProvider {
  provider: string;
  /** Status del run más reciente, o null si nunca corrió. */
  lastRunStatus:
    | "running"
    | "success"
    | "partial"
    | "error"
    | "token_invalid"
    | "rate_limited"
    | "config_missing"
    | null;
  /** ISO timestamp del run más reciente, sin importar el status. */
  lastRunStartedAt: string | null;
  /** ISO timestamp del último run con status='success'. */
  lastSuccessAt: string | null;
  /** rows_written del último run con status='success'. */
  lastSuccessRowsWritten: number | null;
}

interface RunRow {
  provider: string;
  status: IntegrationStatusForProvider["lastRunStatus"];
  started_at: string;
  finished_at: string | null;
  rows_written: number | null;
}

/**
 * Devuelve el estado de cada provider para un launch. RLS (el SELECT policy
 * en integration_runs) ya filtra por `has_project_access` — usamos el client
 * autenticado, no service-role, para que los miembros vean su data y nadie
 * más.
 */
export async function getLaunchIntegrationStatus(
  launchId: string,
): Promise<Map<string, IntegrationStatusForProvider>> {
  const supabase = await createClient();
  // Trae todos los runs del launch ordenados desc — agrupamos por provider
  // en memoria. El volumen esperado es chico (decenas, no miles).
  const { data } = await supabase
    .from("integration_runs")
    .select("provider, status, started_at, finished_at, rows_written")
    .eq("launch_id", launchId)
    .order("started_at", { ascending: false });

  const rows = (data ?? []) as RunRow[];
  const map = new Map<string, IntegrationStatusForProvider>();

  for (const row of rows) {
    const existing = map.get(row.provider);
    if (!existing) {
      map.set(row.provider, {
        provider: row.provider,
        lastRunStatus: row.status,
        lastRunStartedAt: row.started_at,
        lastSuccessAt: row.status === "success" ? row.started_at : null,
        lastSuccessRowsWritten:
          row.status === "success" ? row.rows_written : null,
      });
      continue;
    }
    // Ya tenemos el run más reciente como `lastRunStatus`. Solo falta encontrar
    // el último success (que puede ser anterior al run actual si el último falló).
    if (
      existing.lastSuccessAt === null &&
      row.status === "success"
    ) {
      existing.lastSuccessAt = row.started_at;
      existing.lastSuccessRowsWritten = row.rows_written;
    }
  }

  return map;
}

/**
 * Lista los N runs más recientes de un launch para mostrar el historial.
 * Esta sí incluye error_detail (para el panel "Ver historial").
 */
export interface RunHistoryEntry {
  id: string;
  provider: string;
  status: IntegrationStatusForProvider["lastRunStatus"];
  startedAt: string;
  finishedAt: string | null;
  rowsWritten: number | null;
  errorDetail: unknown;
  windowStart: string | null;
  windowEnd: string | null;
}

export async function listRecentRuns(
  launchId: string,
  limit = 10,
): Promise<RunHistoryEntry[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("integration_runs")
    .select(
      "id, provider, status, started_at, finished_at, rows_written, error_detail, window_start, window_end",
    )
    .eq("launch_id", launchId)
    .order("started_at", { ascending: false })
    .limit(limit);

  interface RawHistoryRow {
    id: string;
    provider: string;
    status: IntegrationStatusForProvider["lastRunStatus"];
    started_at: string;
    finished_at: string | null;
    rows_written: number | null;
    error_detail: unknown;
    window_start: string | null;
    window_end: string | null;
  }

  return ((data ?? []) as RawHistoryRow[]).map((r) => ({
    id: r.id,
    provider: r.provider,
    status: r.status,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    rowsWritten: r.rows_written,
    errorDetail: r.error_detail,
    windowStart: r.window_start,
    windowEnd: r.window_end,
  }));
}
