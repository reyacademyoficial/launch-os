"use client";

import { useMemo, useState, useTransition } from "react";

import { KgDataTable, type Column } from "@/components/kg/data-table";
import { StatusPill } from "@/components/kg/status-pill";
import {
  CompleteEditDrawer,
  type EditContextForComplete,
  type PieceOptionForComplete,
} from "@/components/marketing/complete-edit-drawer";
import {
  computeEditorLoadByWeek,
  countUndatedByPerson,
  type EditorAssetInput,
  type EditorAvailabilityInput,
} from "@/lib/marketing/editor-load";

import { reopenContentEdit } from "./actions";
import {
  EditFormDrawer,
  type EditInitial,
  type OwnerOption,
  type PersonOption,
  type RawOption,
} from "./edit-form-drawer";

// ═══════════════════════════════════════════════════════════════════════════
// Vista dual:
//   1) Tabla de content_edits: la cola de edición. Cada fila es un evento de
//      trabajo ("editar tal crudo") con su editor, su fecha objetivo y el
//      botón para cerrarlo (lo que carga los archivos y los manda al stock).
//   2) Planning semanal (pivot editor × semana): igual que antes, ahora
//      bucketeado por content_edits.dueDate en vez de
//      content_assets.editDueDate — editor-load.ts no cambia, es agnóstico
//      de la tabla origen.
// ═══════════════════════════════════════════════════════════════════════════

export interface EditRowData {
  readonly id: string;
  readonly contentOwnerId: string;
  readonly ownerName: string;
  readonly sourceContentRawId: string | null;
  readonly rawLabel: string | null;
  readonly rawDriveUrl: string | null;
  readonly title: string;
  readonly editorPersonId: string | null;
  readonly editorName: string | null;
  readonly dueDate: string | null; // yyyy-mm-dd
  readonly completedAt: string | null;
  readonly notes: string | null;
  readonly createdAt: string;
}

export function EdicionView({
  rows,
  ownerOptions,
  personOptions,
  rawOptions,
  pieceOptions,
  availability,
  planningWindow,
}: {
  readonly rows: readonly EditRowData[];
  readonly ownerOptions: readonly OwnerOption[];
  readonly personOptions: readonly PersonOption[];
  readonly rawOptions: readonly RawOption[];
  readonly pieceOptions: readonly PieceOptionForComplete[];
  readonly availability: readonly EditorAvailabilityInput[];
  readonly planningWindow: { readonly since: string; readonly until: string };
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [view, setView] = useState<"tabla" | "planning">("tabla");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const noOwners = ownerOptions.length === 0;

  function handleReopen(row: EditRowData) {
    setError(null);
    startTransition(async () => {
      const result = await reopenContentEdit(row.id);
      if ("error" in result) setError(result.error);
    });
  }

  const editing =
    editingId != null ? rows.find((r) => r.id === editingId) ?? null : null;

  const editingInitial: EditInitial | undefined =
    editing != null
      ? {
          id: editing.id,
          contentOwnerId: editing.contentOwnerId,
          sourceContentRawId: editing.sourceContentRawId,
          title: editing.title,
          editorPersonId: editing.editorPersonId,
          dueDate: editing.dueDate,
          notes: editing.notes,
        }
      : undefined;

  const completing =
    completingId != null ? rows.find((r) => r.id === completingId) ?? null : null;

  const completingContext: EditContextForComplete | null =
    completing != null
      ? {
          id: completing.id,
          contentOwnerId: completing.contentOwnerId,
          title: completing.title,
          rawLabel: completing.rawLabel,
        }
      : null;

  // ─── Planning: pivot editor × semana con carga y disponibilidad.
  const editorPersonIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of rows) {
      if (r.editorPersonId != null) ids.add(r.editorPersonId);
    }
    for (const a of availability) ids.add(a.personId);
    const nameOf = new Map(personOptions.map((p) => [p.id, p.fullName]));
    return Array.from(ids).sort((a, b) =>
      (nameOf.get(a) ?? a).localeCompare(nameOf.get(b) ?? b),
    );
  }, [rows, availability, personOptions]);

  const editorAssetsInput: EditorAssetInput[] = useMemo(
    () =>
      rows
        .filter((r) => r.editorPersonId != null)
        .map((r) => ({
          editorPersonId: r.editorPersonId!,
          bucketDate: r.dueDate,
          edited: r.completedAt != null,
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

  const undatedByPerson = useMemo(
    () => countUndatedByPerson(editorAssetsInput, editorPersonIds),
    [editorAssetsInput, editorPersonIds],
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

  const columns: Column<EditRowData>[] = [
    {
      key: "title",
      label: "Edición",
      render: (r) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ color: "var(--kg-text-1)", fontWeight: 600 }}>
            {r.title}
          </span>
          {r.rawLabel && (
            <span className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
              Crudo: {r.rawLabel}
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
      key: "due_date",
      label: "Objetivo",
      render: (r) => {
        if (r.completedAt != null) {
          return (
            <span style={{ color: "var(--kg-text-3)" }}>
              {r.dueDate ? formatDay(r.dueDate) : "—"}
            </span>
          );
        }
        if (r.dueDate == null) {
          return <span style={{ color: "var(--kg-text-3)" }}>Sin fecha</span>;
        }
        const late = isOverdue(r.dueDate);
        return (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontVariantNumeric: "tabular-nums",
              color: "var(--kg-text-1)",
            }}
          >
            {formatDay(r.dueDate)}
            {late && (
              <span
                aria-label="Vencido"
                title="La fecha objetivo ya pasó y la edición sigue en cola"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  background: "var(--kg-negative-500)",
                }}
              />
            )}
          </span>
        );
      },
    },
    {
      key: "status",
      label: "Estado",
      render: (r) =>
        r.completedAt ? (
          <StatusPill
            text={`Realizada ${formatDateTime(r.completedAt)}`}
            tone="var(--kg-positive-500)"
          />
        ) : (
          <StatusPill text="En cola" tone="var(--kg-neutral-500)" />
        ),
    },
    {
      key: "actions",
      label: "",
      align: "right",
      render: (r) => (
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
          {r.completedAt == null ? (
            <button
              type="button"
              onClick={() => setCompletingId(r.id)}
              disabled={pending}
              className="kg-focus"
              style={{
                ...rowBtn,
                borderColor: "var(--kg-accent-500)",
                color: "var(--kg-accent-text)",
              }}
              title="Cargar los archivos que salieron y cerrar esta edición"
            >
              Marcar realizada
            </button>
          ) : (
            <button
              type="button"
              onClick={() => handleReopen(r)}
              disabled={pending}
              className="kg-focus"
              style={rowBtn}
              title="Devolver a la cola (sólo si los archivos no tienen subidas comprometidas)"
            >
              Reabrir
            </button>
          )}
          <button
            type="button"
            onClick={() => setEditingId(r.id)}
            disabled={pending}
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
    <div className="flex min-h-0 flex-1 flex-col">
      <div style={{ padding: "12px 20px 0" }}>
        <div
          role="tablist"
          aria-label="Cambiar vista"
          style={{
            display: "inline-flex",
            gap: 6,
            padding: 4,
            borderRadius: 999,
            background: "var(--kg-surface-2-solid)",
            border: "1px solid var(--kg-border-subtle)",
          }}
        >
          <TabBtn active={view === "tabla"} onClick={() => setView("tabla")} label="Tabla" />
          <TabBtn
            active={view === "planning"}
            onClick={() => setView("planning")}
            label="Planning semanal"
          />
        </div>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            margin: "12px 20px 0",
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

      {view === "tabla" ? (
        <KgDataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          totalCount={rows.length}
          emptyTitle="Sin ediciones en curso"
          emptyHint={
            noOwners
              ? "Primero creá dueños en la pestaña Dueños."
              : "Las ediciones nacen desde un crudo (pestaña Crudos) o se crean sueltas acá. Al marcarlas realizadas, los archivos que salen pasan al stock de Subidas."
          }
          fillHeight
        />
      ) : (
        <div style={{ padding: "12px 20px 20px" }}>
          <PlanningPivot
            cells={planningCells}
            weekStarts={weekStarts}
            editorPersonIds={editorPersonIds}
            personById={personById}
            undatedByPerson={undatedByPerson}
          />
        </div>
      )}

      <EditFormDrawer
        mode="edit"
        open={editingId != null}
        onClose={() => setEditingId(null)}
        ownerOptions={ownerOptions}
        personOptions={personOptions}
        rawOptions={rawOptions}
        initial={editingInitial}
      />

      <CompleteEditDrawer
        open={completingId != null}
        onClose={() => setCompletingId(null)}
        edit={completingContext}
        pieceOptions={pieceOptions}
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
  undatedByPerson,
}: {
  readonly cells: ReturnType<typeof computeEditorLoadByWeek>;
  readonly weekStarts: readonly string[];
  readonly editorPersonIds: readonly string[];
  readonly personById: ReadonlyMap<string, { fullName: string }>;
  readonly undatedByPerson: ReadonlyMap<
    string,
    { assignedAssets: number; pendingAssets: number }
  >;
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
        Todavía no hay editores en el planning. Aparecen acá cuando asignás
        un editor a una edición, o cuando cargás disponibilidad de alguien en
        la pestaña Disponibilidad.
      </div>
    );
  }

  const anyUndated = editorPersonIds.some(
    (id) => (undatedByPerson.get(id)?.assignedAssets ?? 0) > 0,
  );

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
                <div style={{ fontWeight: 700 }}>Semana {formatWeekLabel(ws)}</div>
                <div className="kg-t7" style={{ color: "var(--kg-text-3)", fontWeight: 400 }}>
                  {formatDayShort(ws)}
                </div>
              </th>
            ))}
            {anyUndated && (
              <th style={{ ...thStyle, textAlign: "center" }}>
                <div style={{ fontWeight: 700 }}>Sin fecha</div>
                <div className="kg-t7" style={{ color: "var(--kg-text-3)", fontWeight: 400 }}>
                  sin objetivo
                </div>
              </th>
            )}
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
                          title={`${cell.pendingAssets} pendiente${
                            cell.pendingAssets === 1 ? "" : "s"
                          } de ${cell.assignedAssets} asignado${
                            cell.assignedAssets === 1 ? "" : "s"
                          }`}
                        >
                          {cell.pendingAssets}
                          <span style={{ color: "var(--kg-text-3)", fontWeight: 400 }}>
                            /{cell.assignedAssets}
                          </span>
                        </span>
                        <span className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
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
                {anyUndated && (
                  <td style={{ ...tdStyle, textAlign: "center" }}>
                    <UndatedCell entry={undatedByPerson.get(personId)} />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="kg-t7" style={{ color: "var(--kg-text-3)", marginTop: 10, lineHeight: 1.6 }}>
        Las semanas se arman con la <strong>fecha objetivo</strong> de cada
        edición, no con la fecha en que se cerró. Cada celda muestra{" "}
        <strong>pendientes/asignados</strong> · <strong>días disponibles</strong>{" "}
        según la pestaña Disponibilidad. El punto rojo marca sobrecarga: hay
        trabajo pendiente en una semana sin ningún día disponible. La columna{" "}
        <strong>Sin fecha</strong> junta las ediciones asignadas a las que
        nadie les puso objetivo.
      </div>
    </div>
  );
}

function UndatedCell({
  entry,
}: {
  readonly entry?: { assignedAssets: number; pendingAssets: number };
}) {
  if (!entry || entry.assignedAssets === 0) {
    return <span style={{ color: "var(--kg-text-3)" }}>—</span>;
  }
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontVariantNumeric: "tabular-nums",
      }}
      title={`${entry.pendingAssets} pendiente${
        entry.pendingAssets === 1 ? "" : "s"
      } de ${entry.assignedAssets} sin fecha objetivo`}
    >
      <span style={{ color: "var(--kg-text-1)", fontWeight: 700 }}>
        {entry.pendingAssets}
        <span style={{ color: "var(--kg-text-3)", fontWeight: 400 }}>
          /{entry.assignedAssets}
        </span>
      </span>
      {entry.pendingAssets > 0 && (
        <span
          aria-hidden
          style={{ width: 6, height: 6, borderRadius: 999, background: "var(--kg-warning-500)" }}
        />
      )}
    </span>
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

function formatDay(ymd: string): string {
  const [, m, d] = ymd.split("-");
  if (!m || !d) return ymd;
  return `${d}/${m}`;
}

function isOverdue(dueYmd: string): boolean {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return dueYmd < today;
}
