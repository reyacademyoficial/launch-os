import { buildHourSlots } from "./hours";
import type { ConsumptionConfig, ConsumptionCells, HourSlot } from "./types";

/**
 * Métricas derivadas de la grilla de consumo. Se calculan en el server para
 * las cards ("Total por clase", "Pico por hora", "Promedio por clase") y se
 * pasan al chart como resumen numérico.
 *
 * Convenciones:
 * - Celdas ausentes o no numéricas se cuentan como 0.
 * - "Total" es la suma bruta de asistentes en todos los slots.
 * - "Peak" es el slot con mayor suma (a lo largo de todas las clases).
 * - "Promedio" es total/#slots (con slots vacíos incluidos) — mide consumo
 *   sostenido, no solo picos.
 */

export interface ClassTotal {
  className: string;
  total: number;
  averagePerSlot: number;
}

export interface PeakSlot {
  hour: HourSlot;
  total: number;
}

export interface ConsumptionMetrics {
  /** Un objeto por clase, orden preservado del config. */
  perClass: ClassTotal[];
  /** Slot con mayor total sumando todas las clases. null si no hay datos. */
  peak: PeakSlot | null;
  /** Cantidad de slots (útil para descripciones al pie). */
  slotCount: number;
}

export function computeConsumptionMetrics(
  config: ConsumptionConfig,
  cells: ConsumptionCells,
): ConsumptionMetrics {
  const slots = buildHourSlots(config);
  const slotCount = slots.length;

  const perClass: ClassTotal[] = config.classes.map((className) => {
    let total = 0;
    for (const slot of slots) {
      total += readCell(cells, slot, className);
    }
    const averagePerSlot = slotCount > 0 ? total / slotCount : 0;
    return { className, total, averagePerSlot };
  });

  let peak: PeakSlot | null = null;
  for (const slot of slots) {
    let hourTotal = 0;
    for (const className of config.classes) {
      hourTotal += readCell(cells, slot, className);
    }
    if (hourTotal > 0 && (peak === null || hourTotal > peak.total)) {
      peak = { hour: slot, total: hourTotal };
    }
  }

  return { perClass, peak, slotCount };
}

/** Lee cell con coerción segura a int no-negativo. */
export function readCell(
  cells: ConsumptionCells,
  hour: HourSlot,
  className: string,
): number {
  const row = cells[hour];
  if (!row) return 0;
  const raw = row[className];
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return 0;
  return Math.trunc(raw);
}
