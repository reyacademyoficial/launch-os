"use server";

import { revalidatePath } from "next/cache";

import { buildHourSlots } from "@/lib/launch-consumption/hours";
import type {
  ConsumptionCells,
  ConsumptionConfig,
} from "@/lib/launch-consumption/types";
import { requireCanEditLaunchesIn } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export type ConsumptionActionState = { ok: true } | { error: string } | null;

/**
 * Guarda la grilla de consumo completa. Payload viene como JSON serializado
 * en el field `payload` del FormData — el editor es una sola matriz, se
 * persiste atómicamente en cada Guardar.
 *
 * Validaciones:
 *  - start_time y end_time parseables "HH:MM" y end > start.
 *  - interval_minutes entero en [1, 240] (espejo del CHECK del DB).
 *  - classes no vacío y todos strings no-triviales.
 *  - cells filtrado: solo se persisten (hora, clase) que están en el config;
 *    todo lo demás se descarta silenciosamente para que el JSONB no acumule
 *    basura de configuraciones viejas.
 *
 * Upsert por launch_id (PK) — la primera vez inserta, subsiguientes updatean.
 */
export async function saveConsumption(
  projectId: string,
  launchId: string,
  _prev: ConsumptionActionState,
  formData: FormData,
): Promise<ConsumptionActionState> {
  await requireCanEditLaunchesIn(projectId);

  const raw = String(formData.get("payload") ?? "");
  if (!raw) return { error: "Payload vacío." };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: "Payload inválido (JSON malformado)." };
  }

  const result = normalizePayload(parsed);
  if (!result.ok) return { error: result.error };

  const supabase = await createClient();
  const upsertPayload = {
    launch_id: launchId,
    start_time: result.config.startTime,
    end_time: result.config.endTime,
    interval_minutes: result.config.intervalMinutes,
    classes: result.config.classes,
    cells: result.cells,
  } as never;

  const { error } = await supabase
    .from("launch_consumption")
    .upsert(upsertPayload, { onConflict: "launch_id" });

  if (error) return { error: error.message };

  revalidatePath(`/proyectos/${projectId}/launches/${launchId}/consumo`);
  return { ok: true };
}

interface NormalizedPayload {
  ok: true;
  config: ConsumptionConfig;
  cells: ConsumptionCells;
}
type NormalizeResult = NormalizedPayload | { ok: false; error: string };

/**
 * Corrió-server sanitizer del payload que manda el editor. Espeja las
 * mismas reglas que aplica el UI para que un cliente malicioso no pueda
 * meter horas inválidas o clases duplicadas.
 */
function normalizePayload(raw: unknown): NormalizeResult {
  if (raw === null || typeof raw !== "object") {
    return { ok: false, error: "Payload debe ser un objeto." };
  }
  const rec = raw as Record<string, unknown>;

  const configRaw = rec.config;
  if (configRaw === null || typeof configRaw !== "object") {
    return { ok: false, error: "Falta config." };
  }
  const c = configRaw as Record<string, unknown>;

  const startTime = normalizeHHMM(c.startTime);
  const endTime = normalizeHHMM(c.endTime);
  if (!startTime || !endTime) {
    return { ok: false, error: "Horas inválidas (usá HH:MM 24h)." };
  }
  if (endTime <= startTime) {
    return { ok: false, error: "La hora de fin debe ser mayor a la de inicio." };
  }

  const intervalMinutes = toIntInRange(c.intervalMinutes, 1, 240);
  if (intervalMinutes === null) {
    return { ok: false, error: "El intervalo debe estar entre 1 y 240 minutos." };
  }

  if (!Array.isArray(c.classes)) {
    return { ok: false, error: "El listado de clases es inválido." };
  }
  const classes = c.classes
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter((v) => v.length > 0);
  if (classes.length === 0) {
    return { ok: false, error: "Cargá al menos una clase." };
  }
  if (new Set(classes).size !== classes.length) {
    return { ok: false, error: "Los nombres de clases deben ser únicos." };
  }

  const config: ConsumptionConfig = { startTime, endTime, intervalMinutes, classes };
  const validSlots = new Set(buildHourSlots(config));
  const validClasses = new Set(classes);

  const cellsRaw = rec.cells;
  const cells: ConsumptionCells = {};
  if (cellsRaw !== null && typeof cellsRaw === "object") {
    for (const [hour, row] of Object.entries(cellsRaw as Record<string, unknown>)) {
      if (!validSlots.has(hour)) continue;
      if (row === null || typeof row !== "object") continue;
      const clean: Record<string, number> = {};
      for (const [className, value] of Object.entries(row as Record<string, unknown>)) {
        if (!validClasses.has(className)) continue;
        const n = coerceNonNegInt(value);
        if (n !== null) clean[className] = n;
      }
      if (Object.keys(clean).length > 0) cells[hour] = clean;
    }
  }

  return { ok: true, config, cells };
}

function normalizeHHMM(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!m || m[1] === undefined || m[2] === undefined) return null;
  const h = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (!Number.isFinite(h) || !Number.isFinite(mm)) return null;
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return `${h.toString().padStart(2, "0")}:${mm.toString().padStart(2, "0")}`;
}

function toIntInRange(raw: unknown, min: number, max: number): number | null {
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? parseInt(raw, 10)
        : Number.NaN;
  if (!Number.isFinite(n)) return null;
  const t = Math.trunc(n);
  if (t < min || t > max) return null;
  return t;
}

function coerceNonNegInt(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
    return Math.trunc(raw);
  }
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}
