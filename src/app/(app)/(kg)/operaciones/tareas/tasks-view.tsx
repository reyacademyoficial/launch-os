"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { KgDataTable, type Column } from "@/components/kg/data-table";
import { StatusPill } from "@/components/kg/status-pill";

import { deleteTask } from "./actions";
import {
  TaskFormDrawer,
  type AssigneeOptionForTask,
  type ProjectOptionForTask,
  type TaskInitial,
} from "./task-form-drawer";

// ═══════════════════════════════════════════════════════════════════════════
// Vista de tareas con drawer create/edit y row actions.
//
// Vencidas marcadas visualmente (dot rojo + badge "Vencida") — SIN mutar
// priority ni status en DB. La regla es de presentación: si due_on < today
// y status abierta, se marca. Mutar priority silenciosamente rompería el
// historial ("¿esta era urgente porque el operador la marcó o porque
// venció?").
// ═══════════════════════════════════════════════════════════════════════════

type Status = "todo" | "doing" | "blocked" | "done" | "cancelled";
type Priority = "low" | "med" | "high" | "urgent";

export interface TaskRowData {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly status: Status;
  readonly priority: Priority;
  readonly internalProjectId: string | null;
  readonly internalProjectName: string | null;
  readonly assigneeId: string | null;
  readonly assigneeName: string | null;
  readonly dueOn: string | null;
  readonly completedAt: string | null;
  readonly createdAt: string;
  /** Precomputado server-side: due_on < today y status abierta. */
  readonly isOverdue: boolean;
}

const STATUS_LABEL: Record<Status, string> = {
  todo: "Por hacer",
  doing: "En curso",
  blocked: "Bloqueada",
  done: "Hecha",
  cancelled: "Cancelada",
};

const STATUS_TONE: Record<Status, string> = {
  todo: "var(--kg-neutral-500)",
  doing: "var(--kg-accent-500)",
  blocked: "var(--kg-warning-500)",
  done: "var(--kg-positive-500)",
  cancelled: "var(--kg-neutral-500)",
};

const PRIORITY_LABEL: Record<Priority, string> = {
  low: "Baja",
  med: "Media",
  high: "Alta",
  urgent: "Urgente",
};

const PRIORITY_TONE: Record<Priority, string> = {
  low: "var(--kg-neutral-500)",
  med: "var(--kg-neutral-500)",
  high: "var(--kg-warning-500)",
  urgent: "var(--kg-negative-500)",
};

export function TasksView({
  rows,
  totalCount,
  projects,
  assignees,
  presetProjectId,
  presetAssigneeId,
  canCreate,
}: {
  readonly rows: readonly TaskRowData[];
  readonly totalCount: number;
  readonly projects: readonly ProjectOptionForTask[];
  readonly assignees: readonly AssigneeOptionForTask[];
  readonly presetProjectId: string | null;
  readonly presetAssigneeId: string | null;
  readonly canCreate: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const editing =
    editingId != null ? rows.find((r) => r.id === editingId) ?? null : null;
  const editingInitial: TaskInitial | undefined = editing
    ? {
        id: editing.id,
        title: editing.title,
        description: editing.description,
        status: editing.status,
        priority: editing.priority,
        internalProjectId: editing.internalProjectId,
        assigneeId: editing.assigneeId,
        dueOn: editing.dueOn,
        completedAt: editing.completedAt,
      }
    : undefined;

  function handleDelete(row: TaskRowData) {
    const ok = window.confirm(
      `¿Eliminar la tarea "${row.title}"? Esta acción no se puede deshacer.`,
    );
    if (!ok) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteTask(row.id);
      if ("error" in result) setError(result.error);
    });
  }

  const columns: Column<TaskRowData>[] = [
    {
      key: "title",
      label: "Tarea",
      render: (r) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <button
            type="button"
            onClick={() => setEditingId(r.id)}
            className="kg-focus"
            style={{
              background: "transparent",
              border: "none",
              padding: 0,
              color: "var(--kg-text-1)",
              fontWeight: 600,
              fontSize: 13,
              textAlign: "left",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {r.isOverdue && (
              <span
                aria-label="Vencida"
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
            {r.title}
          </button>
          {r.internalProjectName && (
            <div
              className="kg-t7"
              style={{ color: "var(--kg-text-3)" }}
            >
              {r.internalProjectName}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "assignee",
      label: "Asignada",
      render: (r) =>
        r.assigneeName ?? (
          <span style={{ color: "var(--kg-text-3)" }}>Sin asignar</span>
        ),
    },
    {
      key: "status",
      label: "Estado",
      render: (r) => (
        <StatusPill text={STATUS_LABEL[r.status]} tone={STATUS_TONE[r.status]} />
      ),
    },
    {
      key: "priority",
      label: "Prioridad",
      render: (r) => (
        <StatusPill
          text={PRIORITY_LABEL[r.priority]}
          tone={PRIORITY_TONE[r.priority]}
        />
      ),
    },
    {
      key: "due",
      label: "Vence",
      render: (r) => {
        if (r.dueOn == null) {
          return <span style={{ color: "var(--kg-text-3)" }}>—</span>;
        }
        if (r.isOverdue) {
          return (
            <span
              style={{ color: "var(--kg-negative-500)", fontWeight: 600 }}
              title="Vencida"
            >
              {formatDate(r.dueOn)} · Vencida
            </span>
          );
        }
        return formatDate(r.dueOn);
      },
    },
    {
      key: "actions",
      label: "",
      align: "right",
      render: (r) => (
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={() => setEditingId(r.id)}
            disabled={pending}
            className="kg-focus"
            style={rowBtn}
          >
            Editar
          </button>
          <button
            type="button"
            onClick={() => handleDelete(r)}
            disabled={pending}
            className="kg-focus"
            style={{ ...rowBtn, color: "#EF4444", borderColor: "#EF4444" }}
          >
            Eliminar
          </button>
        </div>
      ),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {canCreate && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="kg-focus"
            style={primaryBtn}
          >
            + Nueva tarea
          </button>
        </div>
      )}

      {error && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: "var(--kg-r-8)",
            background: "rgba(239,68,68,0.10)",
            border: "1px solid #EF4444",
            color: "#EF4444",
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}

      <KgDataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        totalCount={totalCount}
        emptyTitle="Sin tareas que coincidan con el filtro"
        emptyHint="Cambiá el filtro o creá una tarea nueva."
      />

      {canCreate && (
        <>
          <TaskFormDrawer
            mode="create"
            open={creating}
            onClose={() => setCreating(false)}
            projects={projects}
            assignees={assignees}
            presetProjectId={presetProjectId}
            presetAssigneeId={presetAssigneeId}
          />

          <TaskFormDrawer
            mode="edit"
            open={editingId != null}
            onClose={() => setEditingId(null)}
            projects={projects}
            assignees={assignees}
            initial={editingInitial}
          />
        </>
      )}

      {/* Read-only fallback edit: si canCreate=false pero el user hizo click
          en título de fila, no debería pasar (el botón está condicionado).
          Se agrega por defensa: dejamos el editor abierto igual para leer,
          el update va a fallar server-side si el user no tiene permisos. */}
      {!canCreate && (
        <TaskFormDrawer
          mode="edit"
          open={editingId != null}
          onClose={() => setEditingId(null)}
          projects={projects}
          assignees={assignees}
          initial={editingInitial}
        />
      )}
    </div>
  );
}

function formatDate(ymd: string): string {
  try {
    return new Date(`${ymd}T12:00:00Z`).toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return ymd.slice(0, 10);
  }
}

const primaryBtn: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: 999,
  background: "var(--kg-accent-500)",
  border: "none",
  color: "#fff",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
};

const rowBtn: React.CSSProperties = {
  padding: "4px 10px",
  borderRadius: 999,
  background: "transparent",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-2)",
  fontSize: 11,
  fontWeight: 600,
  cursor: "pointer",
};
