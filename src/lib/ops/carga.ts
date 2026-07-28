/**
 * Carga por persona. Función pura, sin acceso a DB.
 *
 * Para cada persona (activa o no, según el input), calcula cuántas tareas
 * ABIERTAS tiene asignadas, cuántas están vencidas y cuántas vencen pronto.
 *
 * "Carga" ≠ "tiempo trabajado". Esto mide COLA DE PENDIENTES; para horas
 * dedicadas ver `sumMinutesByPerson` (usa time_entries).
 *
 * Tareas SIN assignee no se atribuyen a nadie — se pueden reportar aparte
 * con `countUnassignedOpenTasks` si el caller quiere una línea "sin dueño".
 */

import { filterDueSoonTasks, filterOverdueTasks } from "./overdue";
import { isTaskOpen, type OpsPersonRow, type OpsTaskRow, type OpsTimeEntryRow } from "./types";

export interface PersonLoad {
  personId: string;
  personName: string;
  active: boolean;
  /** Tareas en estados todo/doing/blocked asignadas a la persona. */
  open: number;
  /** Subconjunto de `open` con due_on < today. */
  overdue: number;
  /** Subconjunto de `open` con due_on entre today y today+windowDays inclusive. */
  dueSoon: number;
}

export interface ComputeLoadByPersonInputs {
  tasks: OpsTaskRow[];
  people: OpsPersonRow[];
  today: string;
  /** Ventana para "dueSoon". Default 7 días. */
  dueSoonWindowDays?: number;
}

/**
 * Devuelve una fila por persona del input (aunque tenga 0 tareas). El orden
 * respeta el orden de `people` — el caller decide sorting/ranking.
 */
export function computeLoadByPerson(
  inputs: ComputeLoadByPersonInputs,
): PersonLoad[] {
  const windowDays = inputs.dueSoonWindowDays ?? 7;
  const openTasks = inputs.tasks.filter((t) => isTaskOpen(t.status));
  const overdueTasks = filterOverdueTasks(openTasks, inputs.today);
  const dueSoonTasks = filterDueSoonTasks(openTasks, inputs.today, windowDays);

  // Contadores por assignee. Un solo pase por lista.
  const openByPerson = new Map<string, number>();
  const overdueByPerson = new Map<string, number>();
  const dueSoonByPerson = new Map<string, number>();
  bump(openTasks, openByPerson);
  bump(overdueTasks, overdueByPerson);
  bump(dueSoonTasks, dueSoonByPerson);

  return inputs.people.map((p) => ({
    personId: p.id,
    personName: p.full_name,
    active: p.active,
    open: openByPerson.get(p.id) ?? 0,
    overdue: overdueByPerson.get(p.id) ?? 0,
    dueSoon: dueSoonByPerson.get(p.id) ?? 0,
  }));
}

function bump(tasks: OpsTaskRow[], target: Map<string, number>): void {
  for (const t of tasks) {
    if (t.assignee_id == null) continue;
    target.set(t.assignee_id, (target.get(t.assignee_id) ?? 0) + 1);
  }
}

/** Tareas abiertas sin assignee. Útil para "sin dueño" en el dashboard. */
export function countUnassignedOpenTasks(tasks: OpsTaskRow[]): number {
  return tasks.filter((t) => isTaskOpen(t.status) && t.assignee_id == null)
    .length;
}

// ═══════════════════════════════════════════════════════════════════════════
// Horas dedicadas (time_entries)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Σ minutos por persona sobre el subset de time_entries pasado. El caller
 * pre-filtra por ventana temporal (logged_on entre X e Y) — mismo criterio
 * de "el selector no filtra fechas" que finance/kpis.ts.
 */
export function sumMinutesByPerson(
  entries: OpsTimeEntryRow[],
): Map<string, number> {
  const acc = new Map<string, number>();
  for (const e of entries) {
    acc.set(e.person_id, (acc.get(e.person_id) ?? 0) + e.minutes);
  }
  return acc;
}
