/**
 * Throughput operativo. Función pura, sin acceso a DB.
 *
 * "Throughput" = cuánto SALE del pipeline en una ventana. Contamos:
 *   - `completed` — tareas cerradas (status='listo') dentro de [from, to].
 *   - `avgCycleDays` — promedio de días entre created_at y completed_at
 *     de las cerradas. Mide "tiempo de ciclo real".
 *
 * NOTA: desde 0138 el único terminal es 'listo' (colapsa done + cancelled
 * del schema viejo). Ya no distinguimos "completadas ok" de "canceladas".
 *
 * Ventana inclusiva en ambos extremos (ISO strings). El caller pasa las
 * fechas — mismo criterio de "el selector no filtra fechas" que
 * finance/kpis.ts, pero acá SÍ recibimos la ventana como parámetro para
 * poder computar avgCycleDays a partir de las tareas que finalmente
 * cumplen el rango. Si el caller ya pre-filtra, puede pasar el mismo
 * rango como {from, to} y no cambia el resultado.
 */

import type { OpsTaskRow } from "./types";

export interface ThroughputInputs {
  tasks: OpsTaskRow[];
  /** ISO date-time (o YYYY-MM-DD) — comparado lex contra completed_at. */
  from: string;
  /** ISO date-time (o YYYY-MM-DD) — inclusivo. */
  to: string;
}

export interface ThroughputBreakdown {
  completed: number;
  /** Promedio de días para las `completed`. `null` si no hay ninguna. */
  avgCycleDays: number | null;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export function computeThroughput(inputs: ThroughputInputs): ThroughputBreakdown {
  const { from, to } = inputs;
  let completed = 0;
  let cycleSumMs = 0;

  for (const t of inputs.tasks) {
    if (t.completed_at == null) continue;
    if (t.completed_at < from || t.completed_at > to) continue;
    if (t.status !== "listo") continue;

    completed += 1;
    const cycleMs =
      new Date(t.completed_at).getTime() - new Date(t.created_at).getTime();
    // Guard contra data mala (completed antes que created). No summamos
    // negativos ni NaN — mantiene el promedio limpio.
    if (Number.isFinite(cycleMs) && cycleMs >= 0) cycleSumMs += cycleMs;
  }

  const avgCycleDays =
    completed > 0 ? cycleSumMs / completed / MS_PER_DAY : null;

  return { completed, avgCycleDays };
}
