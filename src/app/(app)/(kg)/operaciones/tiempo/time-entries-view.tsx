"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { KgDataTable, type Column } from "@/components/kg/data-table";

import { deleteTimeEntry } from "./actions";
import {
  TimeEntryFormDrawer,
  type PersonOptionForTimeEntry,
  type ProjectOptionForTimeEntry,
  type TaskOptionForTimeEntry,
  type TimeEntryInitial,
} from "./time-entry-form-drawer";

// ═══════════════════════════════════════════════════════════════════════════
// Vista de time_entries.
// ═══════════════════════════════════════════════════════════════════════════

export interface TimeEntryRowData {
  readonly id: string;
  readonly personId: string;
  readonly personName: string;
  readonly minutes: number;
  readonly loggedOn: string;
  readonly taskId: string | null;
  readonly taskTitle: string | null;
  readonly internalProjectId: string | null;
  readonly internalProjectName: string | null;
  readonly notes: string | null;
}

export function TimeEntriesView({
  rows,
  totalCount,
  people,
  tasks,
  projects,
  presetPersonId,
  canCreate,
}: {
  readonly rows: readonly TimeEntryRowData[];
  readonly totalCount: number;
  readonly people: readonly PersonOptionForTimeEntry[];
  readonly tasks: readonly TaskOptionForTimeEntry[];
  readonly projects: readonly ProjectOptionForTimeEntry[];
  readonly presetPersonId: string | null;
  readonly canCreate: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const editing =
    editingId != null ? rows.find((r) => r.id === editingId) ?? null : null;
  const editingInitial: TimeEntryInitial | undefined = editing
    ? {
        id: editing.id,
        personId: editing.personId,
        minutes: editing.minutes,
        loggedOn: editing.loggedOn,
        taskId: editing.taskId,
        internalProjectId: editing.internalProjectId,
        notes: editing.notes,
      }
    : undefined;

  function handleDelete(row: TimeEntryRowData) {
    const ok = window.confirm(
      `¿Eliminar el registro de ${formatHours(row.minutes)} de ${row.personName} el ${formatDate(row.loggedOn)}? Esta acción no se puede deshacer.`,
    );
    if (!ok) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteTimeEntry(row.id);
      if ("error" in result) setError(result.error);
    });
  }

  const columns: Column<TimeEntryRowData>[] = [
    {
      key: "date",
      label: "Fecha",
      render: (r) => formatDate(r.loggedOn),
    },
    {
      key: "person",
      label: "Persona",
      render: (r) => r.personName,
    },
    {
      key: "hours",
      label: "Horas",
      align: "right",
      numeric: true,
      render: (r) => formatHours(r.minutes),
    },
    {
      key: "project",
      label: "Proyecto / Tarea",
      render: (r) => {
        if (!r.internalProjectId && !r.taskId) {
          return <span style={{ color: "var(--kg-text-3)" }}>—</span>;
        }
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {r.internalProjectId && r.internalProjectName && (
              <Link
                href={`/operaciones/proyectos/${r.internalProjectId}`}
                className="kg-focus"
                style={{
                  color: "var(--kg-text-2)",
                  textDecoration: "none",
                  fontSize: 12,
                }}
              >
                📁 {r.internalProjectName}
              </Link>
            )}
            {r.taskTitle && (
              <span
                style={{
                  color: r.internalProjectId
                    ? "var(--kg-text-3)"
                    : "var(--kg-text-2)",
                  fontSize: r.internalProjectId ? 11 : 12,
                }}
                title={r.taskTitle}
              >
                📋 {r.taskTitle}
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: "notes",
      label: "Notas",
      render: (r) =>
        r.notes ? (
          <span
            title={r.notes}
            style={{
              color: "var(--kg-text-2)",
              fontSize: 12,
              maxWidth: 280,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              display: "block",
            }}
          >
            {r.notes}
          </span>
        ) : (
          <span style={{ color: "var(--kg-text-3)" }}>—</span>
        ),
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
            + Cargar tiempo
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
        emptyTitle="Sin registros que coincidan con el filtro"
        emptyHint="Cambiá el filtro o cargá tiempo nuevo."
      />

      <TimeEntryFormDrawer
        mode="create"
        open={creating}
        onClose={() => setCreating(false)}
        people={people}
        tasks={tasks}
        projects={projects}
        presetPersonId={presetPersonId}
      />

      <TimeEntryFormDrawer
        mode="edit"
        open={editingId != null}
        onClose={() => setEditingId(null)}
        people={people}
        tasks={tasks}
        projects={projects}
        initial={editingInitial}
      />
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

function formatHours(minutes: number): string {
  const hours = minutes / 60;
  if (Number.isInteger(hours)) return `${hours} h`;
  return `${hours.toFixed(2).replace(/\.?0+$/, "")} h`;
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
