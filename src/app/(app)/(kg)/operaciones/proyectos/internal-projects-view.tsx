"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { KgDataTable, type Column } from "@/components/kg/data-table";
import { StatusPill } from "@/components/kg/status-pill";

import { syncAllEnabledNotionDatabases } from "../../configuracion/notion/actions";

import {
  InternalProjectFormDrawer,
  type OwnerOption,
  type ProjectInitial,
} from "./internal-project-form-drawer";

// ═══════════════════════════════════════════════════════════════════════════
// Vista de internal_projects con drawer create/edit y row actions.
//
// El delete vive dentro del drawer edit (patrón de Clientes) — es acción
// destructiva y necesita el contexto del form + confirm. La fila muestra
// solo Editar; el archivado se hace desde el drawer cambiando status.
// ═══════════════════════════════════════════════════════════════════════════

type Status =
  | "sin_empezar"
  | "en_proceso"
  | "bloqueado"
  | "alerta_maxima"
  | "listo";
type Priority = "alta" | "media" | "baja";

export interface InternalProjectRowData {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: Status;
  readonly priority: Priority;
  /** Personas responsables (0140 M2M). Vacío = sin dueños. Ya hidratado por server. */
  readonly ownerIds: readonly string[];
  readonly ownerNames: readonly string[];
  readonly startsOn: string | null;
  readonly dueOn: string | null;
  readonly closedAt: string | null;
  readonly notes: string | null;
  /** % de tareas del proyecto en status='listo' sobre el total. Null si no tiene tareas. */
  readonly progressPct: number | null;
  readonly openTasksCount: number;
  /** Si viene de Notion (0132), el id del page. Null para projects nativos KG. */
  readonly notionPageId: string | null;
  readonly notionSyncedAt: string | null;
}

const STATUS_LABEL: Record<Status, string> = {
  sin_empezar: "Sin empezar",
  en_proceso: "En proceso",
  bloqueado: "Bloqueado",
  alerta_maxima: "Alerta máxima",
  listo: "Listo",
};

const STATUS_TONE: Record<Status, string> = {
  sin_empezar: "var(--kg-neutral-500)",
  en_proceso: "var(--kg-accent-500)",
  bloqueado: "var(--kg-warning-500)",
  alerta_maxima: "var(--kg-negative-500)",
  listo: "var(--kg-positive-500)",
};

const PRIORITY_LABEL: Record<Priority, string> = {
  alta: "Alta",
  media: "Media",
  baja: "Baja",
};

const PRIORITY_TONE: Record<Priority, string> = {
  alta: "var(--kg-warning-500)",
  media: "var(--kg-neutral-500)",
  baja: "var(--kg-neutral-500)",
};

export function InternalProjectsView({
  rows,
  totalCount,
  owners,
}: {
  readonly rows: readonly InternalProjectRowData[];
  readonly totalCount: number;
  readonly owners: readonly OwnerOption[];
}) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [syncing, startSync] = useTransition();
  const [syncMessage, setSyncMessage] = useState<
    { kind: "ok" | "error"; text: string } | null
  >(null);

  function handleSyncNotion() {
    setSyncMessage(null);
    startSync(async () => {
      const res = await syncAllEnabledNotionDatabases();
      if (res.errors.length > 0) {
        setSyncMessage({
          kind: "error",
          text: `Sincronización con errores: ${res.errors.length} database(s) fallaron. Últimos: ${res.errors
            .slice(-2)
            .map((e) => e.error)
            .join("; ")}`,
        });
      } else if (res.databasesRun === 0) {
        setSyncMessage({
          kind: "ok",
          text: "No hay databases habilitadas. Configuralas en /configuracion/notion.",
        });
      } else {
        const commentsMsg =
          res.totalCommentsUpserted > 0
            ? ` · ${res.totalCommentsUpserted} comentario(s) sincronizados`
            : "";
        setSyncMessage({
          kind: "ok",
          text: `Sincronizamos ${res.databasesRun} database(s) de ${res.workspacesRun} workspace(s). ${res.totalUpserted} proyecto(s) actualizados${commentsMsg}.`,
        });
      }
    });
  }

  const editing =
    editingId != null ? rows.find((r) => r.id === editingId) ?? null : null;
  const editingInitial: ProjectInitial | undefined = editing
    ? {
        id: editing.id,
        name: editing.name,
        description: editing.description,
        status: editing.status,
        priority: editing.priority,
        ownerIds: editing.ownerIds,
        startsOn: editing.startsOn,
        dueOn: editing.dueOn,
        notes: editing.notes,
        notionPageId: editing.notionPageId,
      }
    : undefined;

  const columns: Column<InternalProjectRowData>[] = [
    {
      key: "name",
      label: "Proyecto",
      render: (r) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Link
              href={`/operaciones/proyectos/${r.id}`}
              className="kg-focus"
              style={{
                color: "var(--kg-text-1)",
                textDecoration: "none",
                fontWeight: 600,
                fontSize: 13,
              }}
            >
              {r.name}
            </Link>
            {r.notionPageId && <NotionBadge pageId={r.notionPageId} />}
          </div>
          {r.description && (
            <div
              className="kg-t7"
              style={{
                color: "var(--kg-text-3)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: 320,
              }}
            >
              {r.description}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "owner",
      label: "Responsables",
      render: (r) =>
        r.ownerNames.length === 0 ? (
          <span style={{ color: "var(--kg-text-3)" }}>Sin dueños</span>
        ) : (
          <span title={r.ownerNames.join(", ")}>
            {r.ownerNames.length <= 2
              ? r.ownerNames.join(", ")
              : `${r.ownerNames.slice(0, 2).join(", ")} +${r.ownerNames.length - 2}`}
          </span>
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
      key: "progress",
      label: "Progreso",
      align: "right",
      numeric: true,
      render: (r) =>
        r.progressPct == null ? (
          <span style={{ color: "var(--kg-text-3)" }}>—</span>
        ) : (
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {r.progressPct}%
          </span>
        ),
    },
    {
      key: "due",
      label: "Vence",
      render: (r) =>
        r.dueOn == null ? (
          <span style={{ color: "var(--kg-text-3)" }}>—</span>
        ) : (
          formatDate(r.dueOn)
        ),
    },
    {
      key: "actions",
      label: "",
      align: "right",
      render: (r) => (
        <button
          type="button"
          onClick={() => setEditingId(r.id)}
          className="kg-focus"
          style={rowBtn}
        >
          Editar
        </button>
      ),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        {syncMessage ? (
          <div
            style={{
              padding: "6px 12px",
              borderRadius: "var(--kg-r-8)",
              background:
                syncMessage.kind === "ok"
                  ? "rgba(0,208,132,0.10)"
                  : "rgba(239,68,68,0.10)",
              border: `1px solid ${syncMessage.kind === "ok" ? "#00D084" : "#EF4444"}`,
              color: syncMessage.kind === "ok" ? "#00D084" : "#EF4444",
              fontSize: 11,
              lineHeight: 1.4,
              flex: 1,
              minWidth: 200,
            }}
          >
            {syncMessage.text}
          </div>
        ) : (
          <div />
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={handleSyncNotion}
            disabled={syncing}
            className="kg-focus"
            style={secondaryBtn}
            title="Trae todos los pages de todas las databases habilitadas de Notion"
          >
            {syncing ? "Sincronizando Notion…" : "Sincronizar Notion"}
          </button>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="kg-focus"
            style={primaryBtn}
          >
            + Nuevo proyecto
          </button>
        </div>
      </div>

      <KgDataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        totalCount={totalCount}
        emptyTitle="Sin proyectos que coincidan con el filtro"
        emptyHint="Cambiá el filtro o creá un proyecto nuevo."
      />

      <InternalProjectFormDrawer
        mode="create"
        open={creating}
        onClose={() => setCreating(false)}
        owners={owners}
      />

      <InternalProjectFormDrawer
        mode="edit"
        open={editingId != null}
        onClose={() => setEditingId(null)}
        owners={owners}
        initial={editingInitial}
      />
    </div>
  );
}

function NotionBadge({ pageId }: { readonly pageId: string }) {
  // Notion espera el page id sin guiones en el URL. La API los devuelve
  // con guiones (uuid formato), así que los sacamos para linkear.
  const href = `https://www.notion.so/${pageId.replace(/-/g, "")}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="kg-focus"
      title="Abrir el page en Notion. Los cambios se sincronizan desde allá — editar en KG lo pisa el próximo sync."
      style={{
        padding: "2px 8px",
        borderRadius: 999,
        background: "rgba(138,138,153,0.15)",
        color: "var(--kg-text-2)",
        fontSize: 10,
        fontWeight: 700,
        textDecoration: "none",
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 4,
          height: 4,
          borderRadius: 999,
          background: "var(--kg-text-3)",
          display: "inline-block",
        }}
      />
      Notion
    </a>
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

const secondaryBtn: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: 999,
  background: "transparent",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-2)",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
  whiteSpace: "nowrap",
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
