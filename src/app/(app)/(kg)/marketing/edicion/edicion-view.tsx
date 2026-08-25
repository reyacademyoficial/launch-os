"use client";

import { useMemo, useState } from "react";

import { KgDataTable, type Column } from "@/components/kg/data-table";
import {
  FORMAT_LABEL,
  type MarketingFormat,
} from "@/lib/marketing/types";
import {
  computeEditorLoadByWeek,
  type EditorAssetInput,
  type EditorAvailabilityInput,
} from "@/lib/marketing/editor-load";

import {
  AssetFormDrawer,
  type AssetInitial,
  type OwnerOption,
  type PersonOption,
  type PieceOption,
  type SessionOption,
} from "./asset-form-drawer";

// ═══════════════════════════════════════════════════════════════════════════
// Vista dual:
//   1) Tabla de assets con acciones (editar + marcar editado).
//   2) Planning semanal (pivot person × week) con warning si overloaded.
//
// El toggle es un tab local (view state) — no vive en searchParams porque
// el planning es visualmente completo por sí solo y no comparte filtros
// server-side con la tabla.
// ═══════════════════════════════════════════════════════════════════════════

export interface AssetRowData {
  readonly id: string;
  readonly contentOwnerId: string;
  readonly ownerName: string;
  readonly sourceRecordingSessionId: string | null;
  readonly sessionLabel: string | null;
  readonly sourceContentPieceId: string | null;
  readonly pieceTitle: string | null;
  readonly name: string;
  readonly format: MarketingFormat;
  readonly driveFolderUrl: string | null;
  readonly driveAssetUrl: string | null;
  readonly durationSeconds: number | null;
  readonly editorPersonId: string | null;
  readonly editorName: string | null;
  readonly editedAt: string | null;
  readonly notes: string | null;
  readonly createdAt: string;
}

export function EdicionView({
  rows,
  ownerOptions,
  personOptions,
  sessionOptions,
  pieceOptions,
  availability,
  planningWindow,
}: {
  readonly rows: readonly AssetRowData[];
  readonly ownerOptions: readonly OwnerOption[];
  readonly personOptions: readonly PersonOption[];
  readonly sessionOptions: readonly SessionOption[];
  readonly pieceOptions: readonly PieceOption[];
  readonly availability: readonly EditorAvailabilityInput[];
  readonly planningWindow: { readonly since: string; readonly until: string };
}) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [view, setView] = useState<"tabla" | "planning">("tabla");

  const noOwners = ownerOptions.length === 0;

  const editing =
    editingId != null ? rows.find((r) => r.id === editingId) ?? null : null;

  const editingInitial: AssetInitial | undefined =
    editing != null
      ? {
          id: editing.id,
          contentOwnerId: editing.contentOwnerId,
          sourceRecordingSessionId: editing.sourceRecordingSessionId,
          sourceContentPieceId: editing.sourceContentPieceId,
          name: editing.name,
          format: editing.format,
          driveFolderUrl: editing.driveFolderUrl,
          driveAssetUrl: editing.driveAssetUrl,
          durationSeconds: editing.durationSeconds,
          editorPersonId: editing.editorPersonId,
          editedAt: editing.editedAt,
          notes: editing.notes,
        }
      : undefined;

  // ─── Planning: pivot person × week con carga y disponibilidad.
  const editorPersonIds = useMemo(
    () =>
      Array.from(
        new Set(
          rows
            .map((r) => r.editorPersonId)
            .filter((x): x is string => x != null),
        ),
      ),
    [rows],
  );

  const editorAssetsInput: EditorAssetInput[] = useMemo(
    () =>
      rows
        .filter((r) => r.editorPersonId != null)
        .map((r) => ({
          editorPersonId: r.editorPersonId!,
          bucketDate: r.editedAt ?? r.createdAt,
        })),
    [rows],
  );

  const planningCells = useMemo(
    () =>
      computeEditorLoadByWeek(
        editorAssetsInput,
        availability,
        planningWindow.since,
        planningWindow.until,
        editorPersonIds,
      ),
    [editorAssetsInput, availability, planningWindow, editorPersonIds],
  );

  const personById = useMemo(() => {
    const map = new Map<string, PersonOption>();
    for (const p of personOptions) map.set(p.id, p);
    return map;
  }, [personOptions]);

  const weekStarts = useMemo(() => {
    if (planningCells.length === 0) return [] as string[];
    const set = new Set(planningCells.map((c) => c.weekStart));
    return Array.from(set).sort();
  }, [planningCells]);

  const columns: Column<AssetRowData>[] = [
    {
      key: "name",
      label: "Nombre",
      render: (r) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ color: "var(--kg-text-1)", fontWeight: 600 }}>
            {r.name}
          </span>
          {r.pieceTitle && (
            <span className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
              Origen: {r.pieceTitle}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "owner",
      label: "Dueño",
      render: (r) => r.ownerName,
    },
    {
      key: "format",
      label: "Formato",
      render: (r) => FORMAT_LABEL[r.format],
    },
    {
      key: "editor",
      label: "Editor",
      render: (r) =>
        r.editorName ? (
          r.editorName
        ) : (
          <span style={{ color: "var(--kg-text-3)" }}>Sin asignar</span>
        ),
    },
    {
      key: "duration",
      label: "Duración",
      align: "right",
      numeric: true,
      render: (r) =>
        r.durationSeconds != null ? `${r.durationSeconds}s` : "—",
    },
    {
      key: "edited_at",
      label: "Editado",
      render: (r) =>
        r.editedAt ? (
          <span
            style={{
              fontVariantNumeric: "tabular-nums",
              color: "var(--kg-text-1)",
            }}
          >
            {formatDateTime(r.editedAt)}
          </span>
        ) : (
          <span style={{ color: "var(--kg-text-3)" }}>En cola</span>
        ),
    },
    {
      key: "drive",
      label: "Archivo",
      render: (r) =>
        r.driveAssetUrl ? (
          <a
            href={r.driveAssetUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: "var(--kg-accent-text)",
              textDecoration: "none",
              fontSize: 11,
            }}
          >
            Abrir ↗
          </a>
        ) : r.driveFolderUrl ? (
          <a
            href={r.driveFolderUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: "var(--kg-text-3)",
              textDecoration: "none",
              fontSize: 11,
            }}
          >
            Carpeta ↗
          </a>
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
            className="kg-focus"
            style={rowBtn}
            title="Editar"
          >
            Editar
          </button>
        </div>
      ),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 8,
          alignItems: "center",
        }}
      >
        <div
          role="tablist"
          aria-label="Cambiar vista"
          style={{
            display: "flex",
            gap: 6,
            padding: 4,
            borderRadius: 999,
            background: "var(--kg-surface-2-solid)",
            border: "1px solid var(--kg-border-subtle)",
          }}
        >
          <TabBtn
            active={view === "tabla"}
            onClick={() => setView("tabla")}
            label="Tabla"
          />
          <TabBtn
            active={view === "planning"}
            onClick={() => setView("planning")}
            label="Planning semanal"
          />
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          disabled={noOwners}
          className="kg-focus"
          style={{ ...primaryBtn, opacity: noOwners ? 0.5 : 1 }}
          title={
            noOwners
              ? "Primero creá al menos un dueño en /marketing/duenos"
              : undefined
          }
        >
          + Nuevo asset
        </button>
      </div>

      {view === "tabla" ? (
        <KgDataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          totalCount={rows.length}
          emptyTitle="Sin assets registrados"
          emptyHint={
            noOwners
              ? "Primero creá dueños en la pestaña Dueños."
              : "Los assets aparecen acá después de una grabación realizada. Un asset por cada corte final que salga de la sesión."
          }
        />
      ) : (
        <PlanningPivot
          cells={planningCells}
          weekStarts={weekStarts}
          editorPersonIds={editorPersonIds}
          personById={personById}
        />
      )}

      <AssetFormDrawer
        mode="create"
        open={creating}
        onClose={() => setCreating(false)}
        ownerOptions={ownerOptions}
        personOptions={personOptions}
        sessionOptions={sessionOptions}
        pieceOptions={pieceOptions}
      />

      <AssetFormDrawer
        mode="edit"
        open={editingId != null}
        onClose={() => setEditingId(null)}
        ownerOptions={ownerOptions}
        personOptions={personOptions}
        sessionOptions={sessionOptions}
        pieceOptions={pieceOptions}
        initial={editingInitial}
      />
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  label,
}: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className="kg-focus"
      style={{
        padding: "6px 14px",
        borderRadius: 999,
        border: "none",
        background: active ? "var(--kg-accent-500)" : "transparent",
        color: active ? "#fff" : "var(--kg-text-2)",
        fontSize: 12,
        fontWeight: 700,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function PlanningPivot({
  cells,
  weekStarts,
  editorPersonIds,
  personById,
}: {
  readonly cells: ReturnType<typeof computeEditorLoadByWeek>;
  readonly weekStarts: readonly string[];
  readonly editorPersonIds: readonly string[];
  readonly personById: ReadonlyMap<string, { fullName: string }>;
}) {
  if (editorPersonIds.length === 0) {
    return (
      <div
        className="kg-t7"
        style={{
          padding: "18px 20px",
          borderRadius: "var(--kg-r-8)",
          background: "var(--kg-surface-2-solid)",
          border: "1px dashed var(--kg-border-subtle)",
          color: "var(--kg-text-3)",
          textAlign: "center",
        }}
      >
        Todavía no hay assets con editor asignado. El planning semanal
        aparece acá cuando asignes al menos un editor a un asset.
      </div>
    );
  }

  const cellByKey = new Map<
    string,
    ReturnType<typeof computeEditorLoadByWeek>[number]
  >();
  for (const c of cells) {
    cellByKey.set(`${c.personId}::${c.weekStart}`, c);
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{
          borderCollapse: "separate",
          borderSpacing: 0,
          minWidth: "100%",
          fontSize: 12,
        }}
      >
        <thead>
          <tr>
            <th
              style={{
                ...thStyle,
                textAlign: "left",
                position: "sticky",
                left: 0,
                background: "var(--kg-surface-2-solid)",
                zIndex: 1,
              }}
            >
              Editor
            </th>
            {weekStarts.map((ws) => (
              <th key={ws} style={{ ...thStyle, textAlign: "center" }}>
                <div style={{ fontWeight: 700 }}>
                  Semana {formatWeekLabel(ws)}
                </div>
                <div
                  className="kg-t7"
                  style={{ color: "var(--kg-text-3)", fontWeight: 400 }}
                >
                  {formatDayShort(ws)}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {editorPersonIds.map((personId) => {
            const person = personById.get(personId);
            return (
              <tr key={personId}>
                <td
                  style={{
                    ...tdStyle,
                    fontWeight: 600,
                    color: "var(--kg-text-1)",
                    position: "sticky",
                    left: 0,
                    background: "var(--kg-surface-1-solid)",
                    zIndex: 1,
                  }}
                >
                  {person?.fullName ?? "(persona desconocida)"}
                </td>
                {weekStarts.map((ws) => {
                  const cell = cellByKey.get(`${personId}::${ws}`);
                  if (!cell) {
                    return (
                      <td key={ws} style={{ ...tdStyle, textAlign: "center" }}>
                        —
                      </td>
                    );
                  }
                  return (
                    <td
                      key={ws}
                      style={{
                        ...tdStyle,
                        textAlign: "center",
                        background: cell.overloaded
                          ? "rgba(239,68,68,0.10)"
                          : undefined,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 6,
                        }}
                      >
                        <span
                          style={{
                            fontVariantNumeric: "tabular-nums",
                            color: "var(--kg-text-1)",
                            fontWeight: 700,
                          }}
                        >
                          {cell.assignedAssets}
                        </span>
                        <span
                          className="kg-t7"
                          style={{ color: "var(--kg-text-3)" }}
                        >
                          · {cell.availableDays}d
                        </span>
                        {cell.overloaded && (
                          <span
                            aria-hidden
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: 999,
                              background: "#EF4444",
                            }}
                          />
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div
        className="kg-t7"
        style={{ color: "var(--kg-text-3)", marginTop: 10 }}
      >
        Cada celda muestra <strong>assets asignados</strong> · <strong>días
        disponibles</strong>. El punto rojo indica sobrecarga (assets
        asignados con cero días disponibles).
      </div>
    </div>
  );
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDayShort(ymd: string): string {
  const [, m, d] = ymd.split("-");
  if (!m || !d) return ymd;
  return `${d}/${m}`;
}

function formatWeekLabel(mondayYmd: string): string {
  return formatDayShort(mondayYmd);
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

const thStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderBottom: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-2)",
  fontSize: 11,
  fontWeight: 600,
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderBottom: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-2)",
  fontSize: 12,
  whiteSpace: "nowrap",
};
