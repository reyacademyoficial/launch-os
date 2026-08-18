import Link from "next/link";

import { resolveCurrentPersonId } from "@/lib/ops/current-person";
import { filterOverdueTasks } from "@/lib/ops/overdue";
import type { OpsTaskRow, TaskPriority, TaskStatus } from "@/lib/ops/types";
import { createClient } from "@/lib/supabase/server";

/**
 * KG · MiJornadaPanel — widget del sidebar con las tareas pendientes del
 * usuario logueado.
 *
 * DISEÑO
 *   - Server component. Resuelve `person_id` vía `auth_user_id` (0111) y
 *     lee las tareas asignadas + abiertas ordenadas por `due_on` asc.
 *   - Si el user no tiene persona vinculada → devuelve null (el widget
 *     no aparece). Típicamente pasa con `dev` o `superadmin` que no
 *     participan en operación diaria.
 *   - Si no hay tareas pendientes → mensaje corto "Sin tareas" en vez de
 *     ocupar espacio con lista vacía.
 *   - Máximo 6 tareas visibles. Un usuario con 40 tareas usa la vista
 *     completa en `/operaciones/tareas` — este panel es un "next up",
 *     no un backlog manager.
 *   - Ordenamiento: `due_on asc nulls last` — las que vencen primero
 *     arriba, sin fecha al fondo. Igual regla que Anexo A del plan.
 *   - Overdue: badge rojo `filterOverdueTasks` de `src/lib/ops/overdue.ts`.
 *   - Sin drawer ni acciones inline: click en la tarea navega a
 *     `/operaciones/tareas` (v1 del Anexo). El botón "Trabajé X min"
 *     queda como iteración futura (requiere client component + action).
 *
 * PERFORMANCE
 *   La query usa el índice parcial `tasks_assignee_open_idx` (0092) que
 *   cubre exactamente este caso: assignee_id + status IN abiertos. RLS
 *   org-scope aplica normalmente vía `can_edit_organization`.
 */

const OPEN_STATUSES: readonly TaskStatus[] = ["todo", "doing"];
const MAX_VISIBLE = 6;

interface TaskRow {
  readonly id: string;
  readonly title: string;
  readonly status: TaskStatus;
  readonly priority: TaskPriority;
  readonly due_on: string | null;
  readonly completed_at: string | null;
  readonly created_at: string;
  readonly assignee_id: string | null;
}

export async function MiJornadaPanel() {
  const personId = await resolveCurrentPersonId();
  if (!personId) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("tasks")
    .select(
      "id, title, status, priority, due_on, completed_at, created_at, assignee_id",
    )
    .eq("assignee_id", personId)
    .in("status", [...OPEN_STATUSES])
    // NULLS LAST + due_on asc: PostgREST no expone nullsLast en .order() —
    // usamos referencedTable pattern con { ascending: true, nullsFirst: false }.
    .order("due_on", { ascending: true, nullsFirst: false })
    .limit(MAX_VISIBLE + 1); // +1 para saber si hay "más"

  const rows = (data ?? []) as TaskRow[];
  const visible = rows.slice(0, MAX_VISIBLE);
  const hasMore = rows.length > MAX_VISIBLE;

  const today = todayYmd();
  const overdueIds = new Set(
    filterOverdueTasks(
      visible.map(taskRowToOps),
      today,
    ).map((t) => t.id),
  );

  return (
    <div
      style={{
        padding: "12px 14px",
        borderRadius: "var(--kg-r-12)",
        background: "var(--kg-surface-2-solid)",
        border: "1px solid var(--kg-border-subtle)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div
          className="kg-t7"
          style={{
            color: "var(--kg-text-3)",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: 0.3,
          }}
        >
          Mi jornada
        </div>
        <Link
          href="/operaciones/tareas"
          className="kg-t7 kg-focus"
          style={{
            color: "var(--kg-text-3)",
            textDecoration: "none",
            fontSize: 10,
          }}
        >
          Ver todas →
        </Link>
      </div>

      {visible.length === 0 ? (
        <div
          className="kg-t7"
          style={{
            color: "var(--kg-text-3)",
            fontStyle: "italic",
            fontSize: 11,
          }}
        >
          Sin tareas pendientes ✓
        </div>
      ) : (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {visible.map((t) => (
            <TaskItem
              key={t.id}
              task={t}
              isOverdue={overdueIds.has(t.id)}
              today={today}
            />
          ))}
        </ul>
      )}

      {hasMore && (
        <div
          className="kg-t7"
          style={{
            color: "var(--kg-text-3)",
            fontSize: 10,
            opacity: 0.7,
            textAlign: "center",
          }}
        >
          + más en /operaciones/tareas
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Item de tarea — priority dot + title + due badge
// ═══════════════════════════════════════════════════════════════════════════

function TaskItem({
  task,
  isOverdue,
  today,
}: {
  readonly task: TaskRow;
  readonly isOverdue: boolean;
  readonly today: string;
}) {
  return (
    <li>
      <Link
        href="/operaciones/tareas"
        className="kg-focus"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 8px",
          borderRadius: "var(--kg-r-8)",
          color: "var(--kg-text-1)",
          textDecoration: "none",
          fontSize: 12,
          lineHeight: 1.3,
        }}
      >
        <PriorityDot priority={task.priority} />
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={task.title}
        >
          {task.title}
        </span>
        <DueBadge dueOn={task.due_on} isOverdue={isOverdue} today={today} />
      </Link>
    </li>
  );
}

function PriorityDot({ priority }: { readonly priority: TaskPriority }) {
  const color = PRIORITY_COLOR[priority];
  return (
    <span
      aria-label={`Prioridad ${priority}`}
      title={PRIORITY_LABEL[priority]}
      style={{
        width: 6,
        height: 6,
        borderRadius: 999,
        background: color,
        flexShrink: 0,
        display: "inline-block",
      }}
    />
  );
}

const PRIORITY_COLOR: Record<TaskPriority, string> = {
  urgent: "#F04060",
  high: "#FFB800",
  med: "var(--kg-text-3)",
  low: "var(--kg-text-3)",
};

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  urgent: "Urgente",
  high: "Alta",
  med: "Media",
  low: "Baja",
};

function DueBadge({
  dueOn,
  isOverdue,
  today,
}: {
  readonly dueOn: string | null;
  readonly isOverdue: boolean;
  readonly today: string;
}) {
  if (!dueOn) return null;
  const label = dueLabel(dueOn, today);
  if (label == null) return null;
  const color = isOverdue
    ? "#F04060"
    : label === "hoy"
      ? "#FFB800"
      : "var(--kg-text-3)";
  return (
    <span
      style={{
        color,
        fontSize: 10,
        fontWeight: 700,
        whiteSpace: "nowrap",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {isOverdue ? "vencida" : label}
    </span>
  );
}

/**
 * Etiqueta compacta para el badge de vencimiento. Vale para "hoy",
 * "mañana" o "en N d" para próximos 7 días; más lejos se muestra el
 * mes y día. Comparación por string YYYY-MM-DD.
 */
function dueLabel(dueOn: string, today: string): string {
  if (dueOn === today) return "hoy";
  const diff = daysBetween(today, dueOn);
  if (diff === 1) return "mañana";
  if (diff > 1 && diff <= 7) return `${diff}d`;
  // Vencida: el caller ya rotula "vencida", no necesita fecha específica.
  if (diff < 0) return "";
  // Más de una semana: día/mes corto ("15 mar").
  return dueOn.slice(5).replace("-", "/");
}

function daysBetween(fromYmd: string, toYmd: string): number {
  const from = Date.UTC(
    Number(fromYmd.slice(0, 4)),
    Number(fromYmd.slice(5, 7)) - 1,
    Number(fromYmd.slice(8, 10)),
  );
  const to = Date.UTC(
    Number(toYmd.slice(0, 4)),
    Number(toYmd.slice(5, 7)) - 1,
    Number(toYmd.slice(8, 10)),
  );
  return Math.round((to - from) / 86_400_000);
}

function todayYmd(): string {
  // Argentina TZ para matchear /operaciones/tareas (calendario laboral).
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  });
}

function taskRowToOps(t: TaskRow): OpsTaskRow {
  return {
    id: t.id,
    assignee_id: t.assignee_id,
    status: t.status,
    priority: t.priority,
    due_on: t.due_on,
    completed_at: t.completed_at,
    created_at: t.created_at,
  };
}
