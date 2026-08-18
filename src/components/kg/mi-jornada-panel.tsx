import Link from "next/link";

import { resolveCurrentPersonId } from "@/lib/ops/current-person";
import { filterOverdueTasks } from "@/lib/ops/overdue";
import type { OpsTaskRow, TaskPriority, TaskStatus } from "@/lib/ops/types";
import { createClient } from "@/lib/supabase/server";

/**
 * KG · MiJornadaPanel — resumen compacto en el sidebar de las tareas
 * abiertas del usuario logueado.
 *
 * DISEÑO (v2 — resumen, no lista)
 *   - Server component. Resuelve `person_id` vía `auth_user_id` (0111).
 *   - Si el user no tiene persona vinculada → devuelve null (widget invisible).
 *   - Muestra 1-3 líneas de contador según lo que haya:
 *       · Total abiertas: siempre.
 *       · Vencidas: solo si > 0 (rojo).
 *       · Urgentes: solo si > 0 (amarillo). Excluye las vencidas para no
 *         doble-contar la señal.
 *   - "Ver todas →" siempre linkea a /operaciones/tareas.
 *   - Si no hay ninguna abierta: "Sin tareas pendientes ✓".
 *
 * PERFORMANCE
 *   La query usa el índice parcial `tasks_assignee_open_idx` (0092) —
 *   assignee_id + status IN abiertos. Solo trae los campos necesarios para
 *   contar (id, priority, due_on, status). Sin límite: un operador con
 *   500 tareas abiertas es un caso que expone un problema mayor de
 *   backlog, no algo que optimizar acá.
 */

const OPEN_STATUSES: readonly TaskStatus[] = ["todo", "doing"];

interface TaskCountRow {
  readonly id: string;
  readonly status: TaskStatus;
  readonly priority: TaskPriority;
  readonly due_on: string | null;
  readonly assignee_id: string | null;
}

export async function MiJornadaPanel() {
  const personId = await resolveCurrentPersonId();
  if (!personId) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("tasks")
    .select("id, status, priority, due_on, assignee_id")
    .eq("assignee_id", personId)
    .in("status", [...OPEN_STATUSES]);

  const rows = (data ?? []) as TaskCountRow[];
  const total = rows.length;

  const today = todayYmd();
  const overdueIds = new Set(
    filterOverdueTasks(rows.map(toOpsRow), today).map((t) => t.id),
  );
  const overdue = overdueIds.size;
  // Urgentes NO vencidas: la vencida ya se muestra como línea propia, no
  // sumarla también acá porque son señales distintas (vencimiento vs
  // priority=urgent asignada por el operador).
  const urgent = rows.filter(
    (t) => t.priority === "urgent" && !overdueIds.has(t.id),
  ).length;

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
      </div>

      {total === 0 ? (
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
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 3,
            fontSize: 12,
            lineHeight: 1.35,
          }}
        >
          <div style={{ color: "var(--kg-text-1)" }}>
            <strong style={{ fontVariantNumeric: "tabular-nums" }}>
              {total}
            </strong>{" "}
            {plural(total, "tarea abierta", "tareas abiertas")}
          </div>
          {overdue > 0 && (
            <div style={{ color: "#F04060", fontWeight: 600 }}>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>
                {overdue}
              </span>{" "}
              {plural(overdue, "vencida", "vencidas")}
            </div>
          )}
          {urgent > 0 && (
            <div style={{ color: "#FFB800", fontWeight: 600 }}>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>
                {urgent}
              </span>{" "}
              {plural(urgent, "urgente", "urgentes")}
            </div>
          )}
        </div>
      )}

      <Link
        href="/operaciones/tareas"
        className="kg-focus"
        style={{
          color: "var(--kg-text-2)",
          textDecoration: "none",
          fontSize: 11,
          fontWeight: 600,
          marginTop: 2,
        }}
      >
        Ver todas →
      </Link>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function plural(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural;
}

function todayYmd(): string {
  // Argentina TZ para matchear /operaciones/tareas (calendario laboral).
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  });
}

function toOpsRow(t: TaskCountRow): OpsTaskRow {
  return {
    id: t.id,
    assignee_id: t.assignee_id,
    status: t.status,
    priority: t.priority,
    due_on: t.due_on,
    // Campos que filterOverdueTasks no lee pero sí requiere el tipo.
    completed_at: null,
    created_at: "",
  };
}
