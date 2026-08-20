"use client";

import Link from "next/link";
import { useState } from "react";

import { StatusPill } from "@/components/kg/status-pill";

import {
  TaskFormDrawer,
  type AssigneeOptionForTask,
  type ProjectOptionForTask,
  type TaskInitial,
} from "../../tareas/task-form-drawer";

// ═══════════════════════════════════════════════════════════════════════════
// Sub-sección "Tareas del proyecto" dentro de la ficha del internal_project.
//
// Reutiliza TaskFormDrawer del módulo /tareas: mismo form de create/edit para
// no dividir la lógica en dos. Pre-setea el proyecto para no obligar al
// operador a re-seleccionarlo.
//
// Muestra: contadores (abiertas/listas + progreso), top-8 abiertas ordenadas
// por vencimiento (nulls last) y link "Ver todas →" al listado filtrado por
// este proyecto. Cerradas viven en la vista global — no ensuciamos la ficha.
// ═══════════════════════════════════════════════════════════════════════════

type TaskStatus =
  | "sin_empezar"
  | "en_proceso"
  | "bloqueado"
  | "alerta_maxima"
  | "listo";

type TaskPriority = "alta" | "media" | "baja";

export interface ProjectTaskRow {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly status: TaskStatus;
  readonly priority: TaskPriority;
  /** Personas asignadas (0141 M2M). Vacío = sin asignar. */
  readonly assigneeIds: readonly string[];
  readonly assigneeNames: readonly string[];
  readonly dueOn: string | null;
  readonly completedAt: string | null;
  /** Precomputado server-side: due_on < today AND status abierta. */
  readonly isOverdue: boolean;
  readonly isRecurring: boolean;
  readonly recurrenceDays: readonly number[] | null;
  readonly estimatedMinutes: number | null;
  readonly completionsCount: number;
  readonly recentCompletions: readonly string[];
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  sin_empezar: "Sin empezar",
  en_proceso: "En proceso",
  bloqueado: "Bloqueada",
  alerta_maxima: "Alerta máxima",
  listo: "Listo",
};

const STATUS_TONE: Record<TaskStatus, string> = {
  sin_empezar: "var(--kg-neutral-500)",
  en_proceso: "var(--kg-accent-500)",
  bloqueado: "var(--kg-warning-500)",
  alerta_maxima: "var(--kg-negative-500)",
  listo: "var(--kg-positive-500)",
};

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  alta: "Alta",
  media: "Media",
  baja: "Baja",
};

const PRIORITY_TONE: Record<TaskPriority, string> = {
  alta: "var(--kg-warning-500)",
  media: "var(--kg-neutral-500)",
  baja: "var(--kg-neutral-500)",
};

const TOP_LIMIT = 8;

export function ProjectTasksSection({
  projectId,
  rows,
  totalOpen,
  totalDone,
  projects,
  assignees,
}: {
  readonly projectId: string;
  /** Todas las tareas del proyecto (abiertas + cerradas). El componente decide qué mostrar. */
  readonly rows: readonly ProjectTaskRow[];
  readonly totalOpen: number;
  readonly totalDone: number;
  readonly projects: readonly ProjectOptionForTask[];
  readonly assignees: readonly AssigneeOptionForTask[];
}) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const total = totalOpen + totalDone;
  const progressPct =
    total > 0 ? Math.round((totalDone / total) * 100) : null;

  // Ordenamos por due_on (asc, nulls last), luego status por severidad para
  // desempatar (alerta_maxima > bloqueado > en_proceso > sin_empezar). Solo
  // mostramos las abiertas — cerradas aportan poco a la vista compacta.
  const openRows = rows.filter((r) => r.status !== "listo");
  const sorted = [...openRows].sort((a, b) => {
    const dueDiff = compareDue(a.dueOn, b.dueOn);
    if (dueDiff !== 0) return dueDiff;
    return statusSeverity(b.status) - statusSeverity(a.status);
  });
  const visible = sorted.slice(0, TOP_LIMIT);
  const hiddenCount = Math.max(0, sorted.length - visible.length);

  const editing =
    editingId != null ? rows.find((r) => r.id === editingId) ?? null : null;
  const editingInitial: TaskInitial | undefined = editing
    ? {
        id: editing.id,
        title: editing.title,
        description: editing.description,
        status: editing.status,
        priority: editing.priority,
        internalProjectId: projectId,
        assigneeIds: editing.assigneeIds,
        dueOn: editing.dueOn,
        completedAt: editing.completedAt,
        isRecurring: editing.isRecurring,
        recurrenceDays: editing.recurrenceDays,
        estimatedMinutes: editing.estimatedMinutes,
        completionsCount: editing.completionsCount,
        recentCompletions: editing.recentCompletions,
      }
    : undefined;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", fontVariantNumeric: "tabular-nums" }}
        >
          {totalOpen} abierta{totalOpen === 1 ? "" : "s"}
          {totalDone > 0 && (
            <>
              {" · "}
              {totalDone} lista{totalDone === 1 ? "" : "s"}
              {progressPct != null && ` · ${progressPct}%`}
            </>
          )}
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="kg-focus"
          style={primaryBtn}
        >
          + Nueva tarea
        </button>
      </header>

      {visible.length === 0 ? (
        <div
          className="kg-t7"
          style={{
            color: "var(--kg-text-3)",
            padding: "18px 4px",
            textAlign: "center",
            lineHeight: 1.5,
          }}
        >
          {totalDone > 0
            ? "Todas las tareas del proyecto están listas ✓"
            : "Todavía no hay tareas. Sumá la primera arriba."}
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
          {visible.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setEditingId(r.id)}
                className="kg-focus"
                style={rowBtn}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 3,
                    flex: 1,
                    minWidth: 0,
                    textAlign: "left",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--kg-text-1)",
                    }}
                  >
                    {r.isOverdue && (
                      <span
                        aria-hidden
                        title="Vencida"
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: 999,
                          background: "var(--kg-negative-500)",
                          flexShrink: 0,
                        }}
                      />
                    )}
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {r.title}
                    </span>
                  </div>
                  <div
                    className="kg-t7"
                    style={{ color: "var(--kg-text-3)", fontSize: 11 }}
                  >
                    {r.assigneeNames.length === 0
                      ? "Sin asignar"
                      : r.assigneeNames.length <= 2
                        ? r.assigneeNames.join(", ")
                        : `${r.assigneeNames.slice(0, 2).join(", ")} +${r.assigneeNames.length - 2}`}
                    {r.dueOn && (
                      <>
                        {" · "}
                        {r.isOverdue ? (
                          <span
                            style={{
                              color: "var(--kg-negative-500)",
                              fontWeight: 600,
                            }}
                          >
                            Vencía {formatDate(r.dueOn)}
                          </span>
                        ) : (
                          <>Vence {formatDate(r.dueOn)}</>
                        )}
                      </>
                    )}
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 6,
                    alignItems: "center",
                    flexShrink: 0,
                  }}
                >
                  <StatusPill
                    text={STATUS_LABEL[r.status]}
                    tone={STATUS_TONE[r.status]}
                  />
                  <StatusPill
                    text={PRIORITY_LABEL[r.priority]}
                    tone={PRIORITY_TONE[r.priority]}
                  />
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Link
        href={`/operaciones/tareas?projectId=${projectId}&status=todas`}
        className="kg-focus"
        style={viewAllLink}
      >
        {hiddenCount > 0
          ? `Ver todas (${hiddenCount} más) →`
          : "Ver en el listado global →"}
      </Link>

      <TaskFormDrawer
        mode="create"
        open={creating}
        onClose={() => setCreating(false)}
        projects={projects}
        assignees={assignees}
        presetProjectId={projectId}
      />
      <TaskFormDrawer
        mode="edit"
        open={editingId != null}
        onClose={() => setEditingId(null)}
        projects={projects}
        assignees={assignees}
        initial={editingInitial}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function compareDue(a: string | null, b: string | null): number {
  // nulls last: sin due_on va al final.
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function statusSeverity(s: TaskStatus): number {
  switch (s) {
    case "alerta_maxima":
      return 4;
    case "bloqueado":
      return 3;
    case "en_proceso":
      return 2;
    case "sin_empezar":
      return 1;
    case "listo":
      return 0;
  }
}

function formatDate(ymd: string): string {
  try {
    return new Date(`${ymd}T12:00:00Z`).toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "short",
    });
  } catch {
    return ymd.slice(0, 10);
  }
}

const primaryBtn: React.CSSProperties = {
  padding: "6px 14px",
  borderRadius: 999,
  background: "var(--kg-accent-500)",
  border: "none",
  color: "#fff",
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const rowBtn: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "10px 12px",
  borderRadius: "var(--kg-r-8)",
  background: "var(--kg-surface-2-solid)",
  border: "1px solid var(--kg-border-subtle)",
  cursor: "pointer",
  width: "100%",
  textAlign: "left",
  color: "inherit",
  font: "inherit",
};

const viewAllLink: React.CSSProperties = {
  color: "var(--kg-text-2)",
  fontSize: 11,
  fontWeight: 700,
  textDecoration: "none",
  padding: "4px 0",
  alignSelf: "flex-start",
};
