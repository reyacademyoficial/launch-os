import "server-only";

import {
  parseSendflowDateKey,
  SENDFLOW_DATE_FORMAT_DEFAULT,
} from "@/lib/integrations/sendflow";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Reader per-day para la serie SendFlow del chart diario (Fase B).
 *
 * No toca DB de escritura ni vuelve a llamar a SendFlow — usa el `raw` que ya
 * persiste el orchestrator en `launch_community_metrics.raw.releases[]`. Ese
 * objeto trae `add_date_keys` (keys "DDMMYYYY" → entered) por release, antes
 * de acotar a la ventana del launch.
 *
 * Acá:
 *  1. Tomamos la fila más reciente por `synced_at` del launch.
 *  2. Parseamos cada key de `add_date_keys` con `parseSendflowDateKey`
 *     (formato default DDMMYYYY — el mismo que usa `parseAnalyticsBody`).
 *  3. Filtramos por `[window_start, window_end]` defensivamente — SendFlow a
 *     veces incluye días un toque fuera del rango pedido (verificado con
 *     data real 2026-06-22).
 *  4. Sumamos `entered` por fecha entre TODAS las releases del launch.
 *
 * Salida ordenada asc por fecha. Devuelve array vacío si no hay sync, o si el
 * raw vino malformado (keys no parsean, releases no es array, etc.).
 *
 * loose() workaround: la tabla `launch_community_metrics` se agregó en
 * migration 0029 y el Database type generado puede no conocerla todavía —
 * mismo patrón que `listCommunityMetricsForLaunch`.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type LooseClient = { from: (name: string) => any };
function loose(svc: unknown): LooseClient {
  return svc as LooseClient;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface SendflowDailyEntry {
  /** YYYY-MM-DD */
  date: string;
  /** Sumatoria de add (entered) entre todas las releases del launch para ese día. */
  entered: number;
}

export interface SendflowDailySeries {
  rows: SendflowDailyEntry[];
  /** Última corrida del sync — la UI puede usarlo para mostrar staleness. */
  syncedAt: string | null;
  /** Ventana del row que estamos leyendo (no necesariamente la actual del launch). */
  windowStart: string | null;
  windowEnd: string | null;
}

export const EMPTY_SENDFLOW_DAILY: SendflowDailySeries = {
  rows: [],
  syncedAt: null,
  windowStart: null,
  windowEnd: null,
};

interface ReleaseRaw {
  add_date_keys?: Record<string, unknown>;
}

interface RawShape {
  releases?: ReleaseRaw[];
}

interface MetricsRow {
  raw: unknown;
  window_start: string | null;
  window_end: string | null;
  synced_at: string | null;
}

export async function listSendflowDailyForLaunch(
  launchId: string,
): Promise<SendflowDailySeries> {
  const service = createServiceClient();
  const { data, error } = await loose(service)
    .from("launch_community_metrics")
    .select("raw, window_start, window_end, synced_at")
    .eq("launch_id", launchId)
    .eq("provider", "sendflow")
    .order("synced_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return EMPTY_SENDFLOW_DAILY;
  const row = data as MetricsRow;

  return parseSendflowDailyRow(row);
}

/**
 * Exportada para test. Acepta el row tal cual sale de la query y devuelve el
 * series ya filtrado por la ventana del row.
 */
export function parseSendflowDailyRow(row: MetricsRow): SendflowDailySeries {
  const windowStart = row.window_start;
  const windowEnd = row.window_end;
  const syncedAt = row.synced_at;

  if (
    row.raw === null ||
    typeof row.raw !== "object" ||
    !windowStart ||
    !windowEnd
  ) {
    return { ...EMPTY_SENDFLOW_DAILY, syncedAt };
  }

  const raw = row.raw as RawShape;
  const releases = Array.isArray(raw.releases) ? raw.releases : [];

  // Acumulador por fecha YYYY-MM-DD. Sumamos `entered` de cada release que
  // toca ese día.
  const byDate = new Map<string, number>();

  for (const rel of releases) {
    if (rel === null || typeof rel !== "object") continue;
    const keys = rel.add_date_keys;
    if (keys === null || typeof keys !== "object") continue;

    for (const [rawKey, value] of Object.entries(keys)) {
      const date = parseSendflowDateKey(rawKey, SENDFLOW_DATE_FORMAT_DEFAULT);
      if (date === null) continue;
      if (date < windowStart || date > windowEnd) continue;
      const n = toInt(value);
      byDate.set(date, (byDate.get(date) ?? 0) + n);
    }
  }

  const rows: SendflowDailyEntry[] = Array.from(byDate.entries())
    .map(([date, entered]) => ({ date, entered }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    rows,
    syncedAt,
    windowStart,
    windowEnd,
  };
}

function toInt(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? Math.trunc(v) : 0;
  if (typeof v === "string") {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}
