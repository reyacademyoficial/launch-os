import "server-only";

import { createClient } from "@/lib/supabase/server";

import {
  DEFAULT_CONSUMPTION_CONFIG,
  type ConsumptionCells,
  type ConsumptionState,
} from "./types";

/**
 * Lee la grilla de consumo persistida para un launch. Si no existe fila,
 * devuelve el estado "vacío" con los defaults de la migración — así el
 * editor renderiza algo usable desde la primera visita sin necesidad de
 * inicializar la fila.
 *
 * RLS filtra: si el caller no tiene acceso al proyecto del launch,
 * devuelve el estado default sin filtrar por error de perm.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type LooseClient = { from: (name: string) => any };
function loose(svc: unknown): LooseClient {
  return svc as LooseClient;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

interface RawRow {
  start_time: string | null;
  end_time: string | null;
  interval_minutes: number | string | null;
  classes: string[] | null;
  cells: unknown;
  updated_at: string | null;
}

export async function getConsumptionForLaunch(
  launchId: string,
): Promise<ConsumptionState> {
  const supabase = await createClient();
  const { data } = await loose(supabase)
    .from("launch_consumption")
    .select("start_time, end_time, interval_minutes, classes, cells, updated_at")
    .eq("launch_id", launchId)
    .maybeSingle();

  const row = (data as RawRow | null) ?? null;
  if (!row) {
    return {
      config: { ...DEFAULT_CONSUMPTION_CONFIG, classes: [...DEFAULT_CONSUMPTION_CONFIG.classes] },
      cells: {},
      updatedAt: null,
    };
  }

  return {
    config: {
      startTime: normalizeHHMM(row.start_time, DEFAULT_CONSUMPTION_CONFIG.startTime),
      endTime: normalizeHHMM(row.end_time, DEFAULT_CONSUMPTION_CONFIG.endTime),
      intervalMinutes: toPositiveInt(
        row.interval_minutes,
        DEFAULT_CONSUMPTION_CONFIG.intervalMinutes,
      ),
      classes:
        Array.isArray(row.classes) && row.classes.length > 0
          ? row.classes.map((c) => String(c))
          : [...DEFAULT_CONSUMPTION_CONFIG.classes],
    },
    cells: sanitizeCells(row.cells),
    updatedAt: row.updated_at,
  };
}

/**
 * Postgres devuelve `time` como "HH:MM:SS" — nos quedamos con "HH:MM".
 * Si el string no matchea, devolvemos el fallback (default de la migración).
 */
function normalizeHHMM(raw: string | null, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const m = /^(\d{1,2}):(\d{2})/.exec(raw.trim());
  if (!m || m[1] === undefined || m[2] === undefined) return fallback;
  const h = m[1].padStart(2, "0");
  return `${h}:${m[2]}`;
}

function toPositiveInt(raw: unknown, fallback: number): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.trunc(raw);
  }
  if (typeof raw === "string") {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return fallback;
}

/**
 * Coerciona el JSONB `cells` a la forma { hora → { clase → int } } filtrando
 * cualquier valor que no sea un número >= 0. Se usa para leer del DB —
 * defense-in-depth por si alguien insertó basura con el service client.
 */
function sanitizeCells(raw: unknown): ConsumptionCells {
  if (raw === null || typeof raw !== "object") return {};
  const out: ConsumptionCells = {};
  for (const [hour, row] of Object.entries(raw as Record<string, unknown>)) {
    if (row === null || typeof row !== "object") continue;
    const clean: Record<string, number> = {};
    for (const [className, value] of Object.entries(row as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
        clean[className] = Math.trunc(value);
      } else if (typeof value === "string") {
        const n = parseInt(value, 10);
        if (Number.isFinite(n) && n >= 0) clean[className] = n;
      }
    }
    out[hour] = clean;
  }
  return out;
}
