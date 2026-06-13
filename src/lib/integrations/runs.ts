import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

/** Umbral del watchdog. Espejo del default usado en la migración 0019.
 *  Si lo cambiás, cambialo en ambos lados o pasalo explícito. */
const STALE_RUN_THRESHOLD_MS = 15 * 60 * 1000;

/**
 * Expira virtualmente un run que está "running" hace demasiado: lo tratamos
 * como 'error' sin tocar la DB acá. La persistencia se hace en otro lado
 * (RPC vía service-role) — pero esto nos permite desbloquear el botón en el
 * mismo render, sin race entre el SELECT y el UPDATE del watchdog.
 */
function isStaleRunning(status: string | null, startedAtIso: string): boolean {
  if (status !== "running") return false;
  const startedMs = Date.parse(startedAtIso);
  if (!Number.isFinite(startedMs)) return false;
  return Date.now() - startedMs > STALE_RUN_THRESHOLD_MS;
}

/**
 * Dispara el watchdog del lado del servidor para que el estado en DB también
 * quede coherente (los suscriptores de Realtime ven la transición a 'error').
 * Fire-and-forget: si falla, el read sigue funcionando porque ya hicimos
 * expiración virtual. Pasa por service-role porque la función es SECURITY
 * DEFINER pero queremos invocarla incluso si el cliente RLS no tiene grant
 * vigente (paranoia controlada).
 */
function fireWatchdogInBackground(): void {
  try {
    const svc = createServiceClient();
    void (
      svc as unknown as {
        rpc: (name: string, args?: Record<string, unknown>) => Promise<unknown>;
      }
    )
      .rpc("expire_stale_integration_runs", { p_threshold: "15 minutes" })
      .catch(() => {
        /* swallow — virtual expiration ya cubre la UI */
      });
  } catch {
    /* swallow */
  }
}

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

export type RunStatus =
  | "running"
  | "success"
  | "partial"
  | "error"
  | "token_invalid"
  | "rate_limited"
  | "config_missing";

/**
 * Stage histórico. Antes había 3 stages por GHL ('appointments' |
 * 'conversations' | 'contacts'); ahora es atómico y queda como 'all'. Los
 * runs viejos pueden tener cualquiera de los valores anteriores o NULL — el
 * tipo los acepta para no romper la lectura de historial.
 */
export type RunStage =
  | "all"
  | "appointments"
  | "conversations"
  | "contacts";

export interface IntegrationStatusForProvider {
  provider: string;
  /** Status del run más reciente del provider. */
  lastRunStatus: RunStatus | null;
  /** ISO timestamp del run más reciente, sin importar el status. */
  lastRunStartedAt: string | null;
  /** ISO timestamp del último run con status='success'. */
  lastSuccessAt: string | null;
  /** rows_written del último run con status='success'. */
  lastSuccessRowsWritten: number | null;
}

interface RunRow {
  provider: string;
  status: RunStatus | null;
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
  // Belt-and-suspenders: persistimos la expiración de runs colgados en DB.
  // No await — la UI ya hace expiración virtual unos pasos abajo, así que
  // el render no depende de que esto complete.
  fireWatchdogInBackground();

  const supabase = await createClient();
  // Trae todos los runs del launch ordenados desc — agrupamos por provider
  // en memoria. Volumen esperado: decenas, no miles.
  const { data } = await supabase
    .from("integration_runs")
    .select("provider, status, started_at, finished_at, rows_written")
    .eq("launch_id", launchId)
    .order("started_at", { ascending: false });

  const rows = (data ?? []) as RunRow[];
  const map = new Map<string, IntegrationStatusForProvider>();

  for (const row of rows) {
    // Expiración virtual: si el run más reciente quedó atascado en 'running'
    // (Server Action timeout, pestaña cerrada), lo tratamos como 'error'
    // antes de que llegue a la UI. Así el gate que desactiva el botón
    // (`lastRunStatus === 'running'`) se desbloquea sin esperar.
    const effectiveStatus = isStaleRunning(row.status, row.started_at)
      ? "error"
      : row.status;

    const existing = map.get(row.provider);
    if (!existing) {
      map.set(row.provider, {
        provider: row.provider,
        lastRunStatus: effectiveStatus,
        lastRunStartedAt: row.started_at,
        lastSuccessAt: effectiveStatus === "success" ? row.started_at : null,
        lastSuccessRowsWritten:
          effectiveStatus === "success" ? row.rows_written : null,
      });
      continue;
    }
    if (existing.lastSuccessAt === null && effectiveStatus === "success") {
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
  stage: RunStage | null;
  status: RunStatus | null;
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
      "id, provider, stage, status, started_at, finished_at, rows_written, error_detail, window_start, window_end",
    )
    .eq("launch_id", launchId)
    .order("started_at", { ascending: false })
    .limit(limit);

  interface RawHistoryRow {
    id: string;
    provider: string;
    stage: RunStage | null;
    status: RunStatus | null;
    started_at: string;
    finished_at: string | null;
    rows_written: number | null;
    error_detail: unknown;
    window_start: string | null;
    window_end: string | null;
  }

  return ((data ?? []) as RawHistoryRow[]).map((r) => {
    // Misma expiración virtual que en getLaunchIntegrationStatus: si la fila
    // está atascada en 'running' hace rato, en la tabla de historial la
    // mostramos como 'error' y agregamos una marca al detail para que el
    // usuario entienda por qué (en vez de ver "Corriendo" sobre algo de ayer).
    const expired = isStaleRunning(r.status, r.started_at);
    return {
      id: r.id,
      provider: r.provider,
      stage: r.stage,
      status: expired ? "error" : r.status,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      rowsWritten: r.rows_written,
      errorDetail: expired
        ? {
            ...(r.error_detail && typeof r.error_detail === "object"
              ? (r.error_detail as Record<string, unknown>)
              : {}),
            cause: "watchdog_expired_virtual",
            message:
              "El sync no terminó en tiempo. Se marcó como error para no bloquear el botón. Re-sincronizá: el sync es idempotente y completa lo que faltó.",
          }
        : r.error_detail,
      windowStart: r.window_start,
      windowEnd: r.window_end,
    };
  });
}
