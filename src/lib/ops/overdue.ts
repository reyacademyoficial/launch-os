/**
 * Filtro de tareas vencidas. Función pura, sin acceso a DB.
 *
 * Regla: una tarea está OVERDUE cuando (a) está en estado abierto
 * (todo|doing|blocked) y (b) tiene `due_on` y es estrictamente anterior a
 * `today`. Empatar (`due_on == today`) NO cuenta como overdue — vence hoy.
 *
 * Fechas se comparan como strings YYYY-MM-DD (lex-sortable, sin timezone).
 * El caller pasa `today` para hacer el selector fácil de testear.
 */

import { isTaskOpen, type OpsTaskRow } from "./types";

/** Devuelve las tareas vencidas al día `today` (YYYY-MM-DD). */
export function filterOverdueTasks(
  tasks: OpsTaskRow[],
  today: string,
): OpsTaskRow[] {
  return tasks.filter(
    (t) => isTaskOpen(t.status) && t.due_on != null && t.due_on < today,
  );
}

/**
 * Tareas que vencen dentro de los próximos `windowDays` días (inclusive
 * de hoy, exclusivo del día siguiente al último). Útil para "próximas a
 * vencer" en dashboards. Overdue NO se cuenta acá — es otra métrica.
 */
export function filterDueSoonTasks(
  tasks: OpsTaskRow[],
  today: string,
  windowDays: number,
): OpsTaskRow[] {
  if (windowDays < 0) return [];
  const horizon = addDaysIso(today, windowDays);
  return tasks.filter(
    (t) =>
      isTaskOpen(t.status) &&
      t.due_on != null &&
      t.due_on >= today &&
      t.due_on <= horizon,
  );
}

/** Suma `days` a una fecha YYYY-MM-DD y devuelve YYYY-MM-DD. */
function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
