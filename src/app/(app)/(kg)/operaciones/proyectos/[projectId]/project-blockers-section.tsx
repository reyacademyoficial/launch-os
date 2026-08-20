"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import {
  BlockerFormDrawer,
  type PersonOptionForBlocker,
  type ProjectOptionForBlocker,
  type TaskOptionForBlocker,
} from "../../bloqueadores/blocker-form-drawer";
import { resolveBlocker } from "../../bloqueadores/actions";

// ═══════════════════════════════════════════════════════════════════════════
// Sub-sección "Bloqueadores" dentro de la ficha del internal_project.
//
// Muestra TODOS los bloqueadores abiertos vinculados al proyecto — tanto los
// que cuelgan del proyecto (internal_project_id = X) como los que cuelgan de
// sus tareas (task_id ∈ tareas del proyecto). Motivo: el operador quiere ver
// en un lugar todo lo que está frenando el proyecto sin tener que entrar
// tarea por tarea. Los task-level muestran el título de la tarea como parent.
//
// Acciones:
//   - Resolver en un click (setea resolved_at=now, resolved_by=persona actual).
//   - "+ Nuevo bloqueador" abre el drawer con parent_kind=project preseteado.
//   - Editar completo: link al listado global. La ficha no repite el drawer
//     de edit para mantener foco en las operaciones más frecuentes.
// ═══════════════════════════════════════════════════════════════════════════

export interface ProjectBlockerRow {
  readonly id: string;
  /** Tipo del padre — task o project. Los de task se ven "adentro" del proyecto. */
  readonly parentKind: "task" | "project";
  /** Título/nombre del padre inmediato para mostrar en la fila. */
  readonly parentLabel: string;
  readonly reason: string;
  readonly openedAt: string;
  readonly daysOpen: number;
}

export function ProjectBlockersSection({
  projectId,
  rows,
  tasksForDrawer,
  projectsForDrawer,
  peopleForDrawer,
}: {
  readonly projectId: string;
  /** Bloqueadores abiertos del proyecto + de sus tareas. */
  readonly rows: readonly ProjectBlockerRow[];
  readonly tasksForDrawer: readonly TaskOptionForBlocker[];
  readonly projectsForDrawer: readonly ProjectOptionForBlocker[];
  readonly peopleForDrawer: readonly PersonOptionForBlocker[];
}) {
  const [creating, setCreating] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleResolve(row: ProjectBlockerRow) {
    const ok = window.confirm(
      `Marcar como resuelto el bloqueo "${row.reason.slice(0, 60)}${
        row.reason.length > 60 ? "…" : ""
      }"?`,
    );
    if (!ok) return;
    setError(null);
    startTransition(async () => {
      const res = await resolveBlocker(row.id);
      if ("error" in res) setError(res.error);
    });
  }

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
          {rows.length === 0
            ? "Sin bloqueadores abiertos"
            : `${rows.length} abierto${rows.length === 1 ? "" : "s"}`}
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="kg-focus"
          style={primaryBtn}
        >
          + Nuevo bloqueador
        </button>
      </header>

      {error && <ErrorBanner text={error} />}

      {rows.length === 0 ? (
        <div
          className="kg-t7"
          style={{
            color: "var(--kg-text-3)",
            padding: "18px 4px",
            textAlign: "center",
            lineHeight: 1.5,
          }}
        >
          Nada está frenando el proyecto ✓
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
          {rows.map((r) => (
            <li key={r.id}>
              <BlockerRow
                row={r}
                onResolve={handleResolve}
                disabled={pending}
              />
            </li>
          ))}
        </ul>
      )}

      <Link
        href={`/operaciones/bloqueadores?status=abiertos`}
        className="kg-focus"
        style={viewAllLink}
      >
        Ver todos en el listado global →
      </Link>

      <BlockerFormDrawer
        mode="create"
        open={creating}
        onClose={() => setCreating(false)}
        tasks={tasksForDrawer}
        projects={projectsForDrawer}
        people={peopleForDrawer}
        presetParentKind="project"
        presetParentId={projectId}
      />
    </div>
  );
}

function BlockerRow({
  row,
  onResolve,
  disabled,
}: {
  readonly row: ProjectBlockerRow;
  readonly onResolve: (r: ProjectBlockerRow) => void;
  readonly disabled: boolean;
}) {
  const ageTone =
    row.daysOpen >= 14
      ? "var(--kg-negative-500)"
      : row.daysOpen >= 7
        ? "var(--kg-warning-500)"
        : "var(--kg-text-3)";
  return (
    <article
      style={{
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        padding: "10px 12px",
        borderRadius: "var(--kg-r-8)",
        background: "var(--kg-surface-2-solid)",
        border: "1px solid var(--kg-border-subtle)",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
            marginBottom: 4,
          }}
        >
          <span
            style={{
              padding: "1px 8px",
              borderRadius: 999,
              background: "rgba(138,138,153,0.15)",
              color: "var(--kg-text-2)",
              fontSize: 10,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 0.3,
            }}
          >
            {row.parentKind === "task" ? "Tarea" : "Proyecto"}
          </span>
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "var(--kg-text-1)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: 280,
            }}
            title={row.parentLabel}
          >
            {row.parentLabel}
          </span>
        </div>
        <div
          style={{
            fontSize: 12,
            lineHeight: 1.45,
            color: "var(--kg-text-2)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {row.reason}
        </div>
        <div
          className="kg-t7"
          style={{ color: ageTone, marginTop: 4, fontVariantNumeric: "tabular-nums" }}
        >
          {row.daysOpen === 0
            ? "Abierto hoy"
            : `${row.daysOpen} día${row.daysOpen === 1 ? "" : "s"} abierto`}
        </div>
      </div>
      <button
        type="button"
        onClick={() => onResolve(row)}
        disabled={disabled}
        className="kg-focus"
        style={{
          padding: "5px 12px",
          borderRadius: 999,
          background: "transparent",
          border: "1px solid var(--kg-positive-500)",
          color: "var(--kg-positive-500)",
          fontSize: 11,
          fontWeight: 700,
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.6 : 1,
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}
      >
        Resolver
      </button>
    </article>
  );
}

function ErrorBanner({ text }: { readonly text: string }) {
  return (
    <div
      style={{
        padding: "8px 10px",
        borderRadius: "var(--kg-r-8)",
        background: "rgba(239,68,68,0.10)",
        border: "1px solid #EF4444",
        color: "#EF4444",
        fontSize: 11,
      }}
    >
      {text}
    </div>
  );
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

const viewAllLink: React.CSSProperties = {
  color: "var(--kg-text-2)",
  fontSize: 11,
  fontWeight: 700,
  textDecoration: "none",
  padding: "4px 0",
  alignSelf: "flex-start",
};
