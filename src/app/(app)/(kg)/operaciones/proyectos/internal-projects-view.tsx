"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { KgDataTable, type Column } from "@/components/kg/data-table";
import { Panel } from "@/components/kg/panel";

import { syncAllEnabledNotionDatabases } from "../../configuracion/notion/actions";

import {
  InternalProjectFormDrawer,
  type OwnerOption,
  type ProjectInitial,
} from "./internal-project-form-drawer";

// ═══════════════════════════════════════════════════════════════════════════
// Vista de internal_projects con drawer create/edit y row actions.
//
// UI copiada del módulo Financiero (facturas / gastos):
//   - Sticky header + scroll interno vía `maxBodyHeight`.
//   - Pills status/priority con dot + color de fondo tenue.
//   - Ellipsis en nombre + descripción con tooltip completo.
//   - Fecha compacta dd/mm/aaaa.
//   - Mini barra de progreso al lado del %.
//   - Botones row en ghostBtn style.
//
// El delete vive dentro del drawer edit (patrón de Clientes) — es acción
// destructiva y necesita el contexto del form + confirm.
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

// Especificación de tono para la pill dot. Cada tono = { bg tenue, fg
// texto, dot sólido }. Mismo esquema que finance/facturas.
type PillTone = "neutral" | "accent" | "warning" | "negative" | "positive";
const PILL_TONE: Record<PillTone, { bg: string; fg: string; dot: string }> = {
  neutral: { bg: "rgba(138,138,153,0.15)", fg: "var(--kg-text-2)", dot: "#8A8A99" },
  accent: { bg: "rgba(64,120,255,0.15)", fg: "#4078FF", dot: "#4078FF" },
  warning: { bg: "rgba(255,184,0,0.15)", fg: "#FFB800", dot: "#FFB800" },
  negative: { bg: "rgba(239,68,68,0.15)", fg: "#EF4444", dot: "#EF4444" },
  positive: { bg: "rgba(0,208,132,0.15)", fg: "#00D084", dot: "#00D084" },
};

const STATUS_SPEC: Record<Status, { label: string; tone: PillTone }> = {
  sin_empezar: { label: "Sin empezar", tone: "neutral" },
  en_proceso: { label: "En proceso", tone: "accent" },
  bloqueado: { label: "Bloqueado", tone: "warning" },
  alerta_maxima: { label: "Alerta máxima", tone: "negative" },
  listo: { label: "Listo", tone: "positive" },
};

const PRIORITY_SPEC: Record<Priority, { label: string; tone: PillTone }> = {
  alta: { label: "Alta", tone: "warning" },
  media: { label: "Media", tone: "neutral" },
  baja: { label: "Baja", tone: "neutral" },
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
              title={r.name}
              style={{
                color: "var(--kg-text-1)",
                textDecoration: "none",
                fontWeight: 600,
                fontSize: 13,
                ...ellipsis,
              }}
            >
              {r.name}
            </Link>
            {r.notionPageId && <NotionBadge pageId={r.notionPageId} />}
          </div>
          {r.description && (
            <div
              className="kg-t7"
              style={{ color: "var(--kg-text-3)", ...ellipsis }}
              title={r.description}
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
          <span style={{ color: "var(--kg-text-3)", fontStyle: "italic" }}>
            sin dueños
          </span>
        ) : (
          <span
            title={r.ownerNames.join(", ")}
            style={{ ...ellipsis, maxWidth: 180 }}
          >
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
        <DotPill
          label={STATUS_SPEC[r.status].label}
          tone={STATUS_SPEC[r.status].tone}
        />
      ),
    },
    {
      key: "priority",
      label: "Prioridad",
      render: (r) => (
        <DotPill
          label={PRIORITY_SPEC[r.priority].label}
          tone={PRIORITY_SPEC[r.priority].tone}
        />
      ),
    },
    {
      key: "progress",
      label: "Progreso",
      align: "right",
      render: (r) =>
        r.progressPct == null ? (
          <span style={{ color: "var(--kg-text-3)" }}>—</span>
        ) : (
          <ProgressCell pct={r.progressPct} openCount={r.openTasksCount} />
        ),
    },
    {
      key: "due",
      label: "Vence",
      render: (r) =>
        r.dueOn == null ? (
          <span style={{ color: "var(--kg-text-3)" }}>—</span>
        ) : (
          fmtDate(r.dueOn)
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
          style={ghostBtn}
          title="Editar proyecto"
        >
          Editar
        </button>
      ),
    },
  ];

  const headerActions = (
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
  );

  return (
    <>
      <Panel title="Proyectos internos" actions={headerActions} pad={false}>
        {syncMessage && (
          <div
            style={{
              margin: "12px 20px 0",
              padding: "8px 12px",
              borderRadius: "var(--kg-r-8)",
              background:
                syncMessage.kind === "ok"
                  ? "rgba(0,208,132,0.10)"
                  : "rgba(239,68,68,0.10)",
              border: `1px solid ${syncMessage.kind === "ok" ? "#00D084" : "#EF4444"}`,
              color: syncMessage.kind === "ok" ? "#00D084" : "#EF4444",
              fontSize: 11,
              lineHeight: 1.4,
            }}
          >
            {syncMessage.text}
          </div>
        )}
        <div style={{ padding: syncMessage ? "12px 0 0" : 0 }}>
          <KgDataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            totalCount={totalCount}
            emptyTitle="Sin proyectos que coincidan con el filtro"
            emptyHint="Cambiá el filtro o creá un proyecto nuevo."
            maxBodyHeight="calc(100vh - 260px)"
          />
        </div>
      </Panel>

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
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Sub-componentes de presentación
// ═══════════════════════════════════════════════════════════════════════════

function DotPill({
  label,
  tone,
}: {
  readonly label: string;
  readonly tone: PillTone;
}) {
  const spec = PILL_TONE[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px",
        borderRadius: 999,
        background: spec.bg,
        color: spec.fg,
        fontSize: 11,
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: spec.dot,
          display: "inline-block",
        }}
      />
      {label}
    </span>
  );
}

function ProgressCell({
  pct,
  openCount,
}: {
  readonly pct: number;
  readonly openCount: number;
}) {
  // Verde arriba de 66, ámbar entre 33 y 66, gris debajo. Neutro para 100
  // (proyecto casi cerrado) para no gritar el color pleno.
  const barColor =
    pct >= 100
      ? "var(--kg-positive-500)"
      : pct >= 66
        ? "#00D084"
        : pct >= 33
          ? "#FFB800"
          : "var(--kg-text-3)";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        justifyContent: "flex-end",
      }}
      title={`${openCount} abiertas`}
    >
      <span
        style={{
          width: 60,
          height: 6,
          borderRadius: 999,
          background: "rgba(138,138,153,0.15)",
          overflow: "hidden",
          display: "inline-block",
        }}
        aria-hidden
      >
        <span
          style={{
            display: "block",
            height: "100%",
            width: `${Math.min(100, Math.max(0, pct))}%`,
            background: barColor,
          }}
        />
      </span>
      <span
        style={{
          fontVariantNumeric: "tabular-nums",
          color: "var(--kg-text-2)",
          fontSize: 11,
          fontWeight: 600,
          minWidth: 32,
          textAlign: "right",
        }}
      >
        {pct}%
      </span>
    </span>
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
        flexShrink: 0,
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

// Fecha compacta dd/mm/aaaa — mismo formato que finance (facturas/gastos).
function fmtDate(iso: string): string {
  const s = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00Z` : iso;
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Estilos compartidos
// ═══════════════════════════════════════════════════════════════════════════

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

const ghostBtn: React.CSSProperties = {
  padding: "4px 10px",
  borderRadius: 999,
  background: "transparent",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-2)",
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
};

const ellipsis: React.CSSProperties = {
  display: "inline-block",
  maxWidth: 280,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  verticalAlign: "middle",
};
