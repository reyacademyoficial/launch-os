"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { KgDataTable, type Column } from "@/components/kg/data-table";
import { StatusPill } from "@/components/kg/status-pill";

import { deleteBlocker, resolveBlocker } from "./actions";
import {
  BlockerFormDrawer,
  type BlockerInitial,
  type PersonOptionForBlocker,
  type ProjectOptionForBlocker,
  type TaskOptionForBlocker,
} from "./blocker-form-drawer";

// ═══════════════════════════════════════════════════════════════════════════
// Vista de bloqueadores. La columna "Sobre" resuelve el XOR: si task_id,
// muestra la tarea con link a /operaciones/tareas; si internal_project_id,
// muestra el proyecto con link a la ficha.
//
// Acción "Resolver" es un atajo que setea resolved_at=now() +
// resolved_by=me. Para casos con fecha o quién distintos, se usa Editar.
// ═══════════════════════════════════════════════════════════════════════════

export interface BlockerRowData {
  readonly id: string;
  readonly parentKind: "task" | "project";
  readonly parentId: string;
  readonly parentLabel: string;
  readonly parentProjectId: string | null;
  readonly parentProjectName: string | null;
  readonly reason: string;
  readonly openedAt: string;
  readonly resolvedAt: string | null;
  readonly resolvedById: string | null;
  readonly resolvedByName: string | null;
  /** Precomputado server-side. */
  readonly daysOpen: number;
}

export function BlockersView({
  rows,
  totalCount,
  tasks,
  projects,
  people,
}: {
  readonly rows: readonly BlockerRowData[];
  readonly totalCount: number;
  readonly tasks: readonly TaskOptionForBlocker[];
  readonly projects: readonly ProjectOptionForBlocker[];
  readonly people: readonly PersonOptionForBlocker[];
}) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const editing =
    editingId != null ? rows.find((r) => r.id === editingId) ?? null : null;
  const editingInitial: BlockerInitial | undefined = editing
    ? {
        id: editing.id,
        parentKind: editing.parentKind,
        parentId: editing.parentId,
        reason: editing.reason,
        resolvedAt: editing.resolvedAt,
        resolvedBy: editing.resolvedById,
      }
    : undefined;

  function handleResolve(row: BlockerRowData) {
    const ok = window.confirm(
      `¿Marcar este bloqueador como resuelto ahora? Se registra la fecha de hoy y tu usuario.`,
    );
    if (!ok) return;
    setError(null);
    startTransition(async () => {
      const result = await resolveBlocker(row.id);
      if ("error" in result) setError(result.error);
    });
  }

  function handleDelete(row: BlockerRowData) {
    const ok = window.confirm(
      `¿Eliminar el bloqueador "${row.reason.slice(0, 60)}${row.reason.length > 60 ? "…" : ""}"? Esta acción no se puede deshacer.`,
    );
    if (!ok) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteBlocker(row.id);
      if ("error" in result) setError(result.error);
    });
  }

  const columns: Column<BlockerRowData>[] = [
    {
      key: "reason",
      label: "Motivo",
      render: (r) => (
        <button
          type="button"
          onClick={() => setEditingId(r.id)}
          className="kg-focus"
          style={{
            background: "transparent",
            border: "none",
            padding: 0,
            color: "var(--kg-text-1)",
            fontSize: 13,
            textAlign: "left",
            cursor: "pointer",
            maxWidth: 400,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            display: "block",
          }}
          title={r.reason}
        >
          {r.reason}
        </button>
      ),
    },
    {
      key: "parent",
      label: "Sobre",
      render: (r) => {
        if (r.parentKind === "task") {
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span
                style={{ color: "var(--kg-text-2)", fontSize: 12 }}
                title={r.parentLabel}
              >
                📋 {r.parentLabel}
              </span>
              {r.parentProjectId && r.parentProjectName && (
                <Link
                  href={`/operaciones/proyectos/${r.parentProjectId}`}
                  className="kg-focus"
                  style={{
                    color: "var(--kg-text-3)",
                    textDecoration: "none",
                    fontSize: 11,
                  }}
                >
                  {r.parentProjectName}
                </Link>
              )}
            </div>
          );
        }
        return (
          <Link
            href={`/operaciones/proyectos/${r.parentId}`}
            className="kg-focus"
            style={{
              color: "var(--kg-text-2)",
              textDecoration: "none",
              fontSize: 12,
            }}
          >
            📁 {r.parentLabel}
          </Link>
        );
      },
    },
    {
      key: "status",
      label: "Estado",
      render: (r) => {
        if (r.resolvedAt) {
          return (
            <StatusPill text="Resuelto" tone="var(--kg-positive-500)" />
          );
        }
        return <StatusPill text="Abierto" tone="var(--kg-negative-500)" />;
      },
    },
    {
      key: "aging",
      label: "Antigüedad",
      render: (r) => {
        if (r.resolvedAt) {
          return (
            <span style={{ color: "var(--kg-text-3)", fontSize: 12 }}>
              Cerrado {formatDate(r.resolvedAt)}
              {r.resolvedByName ? ` · ${r.resolvedByName}` : ""}
            </span>
          );
        }
        const tone =
          r.daysOpen >= 7
            ? "var(--kg-negative-500)"
            : r.daysOpen >= 3
              ? "var(--kg-warning-500)"
              : "var(--kg-text-2)";
        return (
          <span style={{ color: tone, fontSize: 12 }}>
            {r.daysOpen === 0
              ? "abierto hoy"
              : r.daysOpen === 1
                ? "abierto hace 1 día"
                : `abierto hace ${r.daysOpen} días`}
          </span>
        );
      },
    },
    {
      key: "actions",
      label: "",
      align: "right",
      render: (r) => (
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
          {!r.resolvedAt && (
            <button
              type="button"
              onClick={() => handleResolve(r)}
              disabled={pending}
              className="kg-focus"
              style={{
                ...rowBtn,
                color: "var(--kg-positive-500)",
                borderColor: "var(--kg-positive-500)",
              }}
            >
              Resolver
            </button>
          )}
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
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="kg-focus"
          style={primaryBtn}
        >
          + Nuevo bloqueador
        </button>
      </div>

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
        emptyTitle="Sin bloqueadores que coincidan con el filtro"
        emptyHint="Cambiá el filtro o creá un bloqueador nuevo."
      />

      <BlockerFormDrawer
        mode="create"
        open={creating}
        onClose={() => setCreating(false)}
        tasks={tasks}
        projects={projects}
        people={people}
      />

      <BlockerFormDrawer
        mode="edit"
        open={editingId != null}
        onClose={() => setEditingId(null)}
        tasks={tasks}
        projects={projects}
        people={people}
        initial={editingInitial}
      />
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00Z` : iso).toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
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
