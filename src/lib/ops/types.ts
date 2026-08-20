/**
 * Tipos org-level para el módulo Operaciones de Kingrow.
 *
 * SHAPES MANUALES en el borde (cast at the boundary), mismo estilo que
 * finance/types.ts y settlements/types.ts. Los selectores puros de este
 * módulo esperan estos subsets como CONTRATO — el caller (server action /
 * loader) lee las rows con Supabase y las castea antes de pasar. Los
 * selectores NUNCA tocan Supabase.
 *
 * Solo se declaran los campos que los selectores realmente leen; el resto
 * de la fila se ignora. Cuando se regeneren los types con `supabase gen
 * types`, van a quedar como subset compatible de
 * `Database["public"]["Tables"][X]["Row"]`.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Tareas (`tasks` 0092)
// ═══════════════════════════════════════════════════════════════════════════

export type TaskStatus =
  | "sin_empezar"
  | "en_proceso"
  | "bloqueado"
  | "alerta_maxima"
  | "listo";
export type TaskPriority = "alta" | "media" | "baja";

/**
 * Estados en los que la tarea sigue "abierta" (consume atención). El único
 * estado cerrado es 'listo' — desde 0138 colapsamos 'done' y 'cancelled' en
 * un solo terminal para alinear con Notion.
 */
export const OPEN_TASK_STATUSES: readonly TaskStatus[] = [
  "sin_empezar",
  "en_proceso",
  "bloqueado",
  "alerta_maxima",
] as const;

export function isTaskOpen(status: TaskStatus): boolean {
  return OPEN_TASK_STATUSES.includes(status);
}

/**
 * Subset de `tasks` para carga, throughput y overdue.
 * - `assignee_ids` vacío = tarea sin dueño (0141 M2M).
 * - `due_on` NULL = sin vencimiento (nunca cuenta como overdue).
 * - `completed_at` NULL = no finalizada aún.
 *
 * `assignee_ids` viene ya hidratado desde task_assignees por el caller —
 * los selectores puros no tocan DB.
 */
export interface OpsTaskRow {
  id: string;
  assignee_ids: readonly string[];
  status: TaskStatus;
  priority: TaskPriority;
  due_on: string | null;        // YYYY-MM-DD
  completed_at: string | null;  // timestamptz ISO
  created_at: string;           // timestamptz ISO
}

// ═══════════════════════════════════════════════════════════════════════════
// Personas (`organization_people` 0058)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Subset de `organization_people`. `active=false` = persona dada de baja;
 * el caller decide si filtrarla del reporte o mostrarla con marca "inactiva".
 */
export interface OpsPersonRow {
  id: string;
  full_name: string;
  active: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Time entries (`time_entries` 0096)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Subset de `time_entries`. Asiento contable (minutes + logged_on), no
 * cronómetro. El caller pre-filtra por ventana temporal si aplica.
 */
export interface OpsTimeEntryRow {
  person_id: string;
  minutes: number;
  logged_on: string;  // YYYY-MM-DD
}
