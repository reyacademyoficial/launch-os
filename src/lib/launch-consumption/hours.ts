import type { ConsumptionConfig, HourSlot } from "./types";

/**
 * Genera la lista de slots "HH:MM" dado start/end/interval.
 *
 * Regla: incluye `startTime`; el último slot es el mayor `t` tal que
 * `t <= endTime` y `t = startTime + k*interval`. Con start=09:00, end=12:00,
 * interval=10 → 19 slots (09:00, 09:10, ..., 12:00).
 *
 * Robusto ante entradas absurdas: si el interval es <=0 o los tiempos no
 * parsean, devuelve array vacío en lugar de romper (la UI muestra "config
 * inválida"). La validación estricta corre en el server action.
 */
export function buildHourSlots(config: ConsumptionConfig): HourSlot[] {
  const start = parseHHMM(config.startTime);
  const end = parseHHMM(config.endTime);
  const step = config.intervalMinutes;

  if (start === null || end === null) return [];
  if (!Number.isFinite(step) || step <= 0) return [];
  if (end <= start) return [];

  // Cap defensivo: 24h/1min = 1440 slots. Con interval=1 y ventana chica
  // no llegamos; con ventanas exóticas cortamos en 500 para no colgar UI.
  const MAX_SLOTS = 500;

  const slots: HourSlot[] = [];
  for (let t = start; t <= end && slots.length < MAX_SLOTS; t += step) {
    slots.push(formatHHMM(t));
  }
  return slots;
}

/** Convierte "HH:MM" → minutos desde 00:00. Devuelve null si no parsea. */
export function parseHHMM(input: string): number | null {
  if (typeof input !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(input.trim());
  if (!m || m[1] === undefined || m[2] === undefined) return null;
  const h = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (!Number.isFinite(h) || !Number.isFinite(mm)) return null;
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

/** Minutos → "HH:MM" (siempre 2 dígitos). */
export function formatHHMM(totalMinutes: number): HourSlot {
  const t = Math.max(0, Math.trunc(totalMinutes));
  const h = Math.floor(t / 60) % 24;
  const mm = t % 60;
  return `${pad2(h)}:${pad2(mm)}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
