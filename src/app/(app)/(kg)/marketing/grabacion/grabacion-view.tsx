"use client";

import { useMemo, useState, useTransition } from "react";

import { KgCalendar, type KgCalendarEvent } from "@/components/kg/calendar";
import { KgDataTable, type Column } from "@/components/kg/data-table";
import { Drawer } from "@/components/kg/drawer";
import { StatusPill } from "@/components/kg/status-pill";
import {
  RECORDING_SESSION_STATUSES,
  ROLE_LABEL,
  SESSION_STATUS_LABEL,
  SESSION_STATUS_TONE,
  type RecordingRole,
  type RecordingSessionStatus,
} from "@/lib/marketing/types";

import { setSessionStatus } from "./actions";
import {
  SessionFormDrawer,
  type OwnerOption,
  type PersonOption,
  type PieceOption,
  type SessionInitial,
} from "./session-form-drawer";

// ═══════════════════════════════════════════════════════════════════════════
// Vista dual tabla / calendario para recording_sessions.
//
// La page decide qué componente renderizar según ?view=tabla|calendario y
// nos pasa las rows + año/mes visible. Nosotros manejamos:
//   - drawer create (nueva sesión sin fecha pre-cargada, o con la fecha
//     del día clickeado en el calendario si venís desde ahí)
//   - drawer edit (fila clickeada de la tabla o item clickeado del popover
//     del día en el calendario)
//   - popover del día (calendario) — lista de sesiones del día + botones
//   - toggle de status inline en la tabla
// ═══════════════════════════════════════════════════════════════════════════

export interface SessionRowData {
  readonly id: string;
  readonly contentOwnerId: string;
  readonly ownerName: string;
  readonly scheduledAt: string;
  readonly durationMinutes: number | null;
  readonly location: string | null;
  readonly materials: string | null;
  readonly notes: string | null;
  readonly status: RecordingSessionStatus;
  readonly assignees: readonly {
    readonly personId: string;
    readonly personName: string;
    readonly role: RecordingRole;
  }[];
  readonly pieceIds: readonly string[];
  readonly piecesCount: number;
}

export function GrabacionView({
  view,
  rows,
  year,
  month,
  baseHref,
  preserveParams,
  ownerOptions,
  personOptions,
  pieceOptions,
}: {
  readonly view: "tabla" | "calendario";
  readonly rows: readonly SessionRowData[];
  readonly year: number;
  readonly month: number;
  readonly baseHref: string;
  readonly preserveParams?: Record<string, string | null>;
  readonly ownerOptions: readonly OwnerOption[];
  readonly personOptions: readonly PersonOption[];
  readonly pieceOptions: readonly PieceOption[];
}) {
  const [creating, setCreating] = useState<
    { open: true; presetDate?: string } | { open: false }
  >({ open: false });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dayDrawerKey, setDayDrawerKey] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const noOwners = ownerOptions.length === 0;

  const editing =
    editingId != null ? rows.find((r) => r.id === editingId) ?? null : null;

  const editingInitial: SessionInitial | undefined =
    editing != null
      ? {
          id: editing.id,
          contentOwnerId: editing.contentOwnerId,
          scheduledAt: editing.scheduledAt,
          durationMinutes: editing.durationMinutes,
          location: editing.location,
          materials: editing.materials,
          notes: editing.notes,
          assignees: editing.assignees.map((a) => ({
            personId: a.personId,
            role: a.role,
          })),
          pieceIds: editing.pieceIds,
        }
      : undefined;

  const eventsByDate = useMemo(() => {
    const map = new Map<string, KgCalendarEvent[]>();
    for (const r of rows) {
      const key = toDateKey(r.scheduledAt);
      if (!key) continue;
      const arr = map.get(key) ?? [];
      arr.push({
        id: r.id,
        label: `${formatTime(r.scheduledAt)} · ${r.ownerName}`,
        tone: SESSION_STATUS_TONE[r.status],
      });
      map.set(key, arr);
    }
    // Ordenar cada día por hora
    for (const [k, arr] of map) {
      arr.sort((a, b) => a.label.localeCompare(b.label));
      map.set(k, arr);
    }
    return map;
  }, [rows]);

  const rowsOfDay = useMemo(() => {
    if (dayDrawerKey == null) return [];
    return rows
      .filter((r) => toDateKey(r.scheduledAt) === dayDrawerKey)
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  }, [dayDrawerKey, rows]);

  function handleStatusChange(row: SessionRowData, next: RecordingSessionStatus) {
    setError(null);
    startTransition(async () => {
      const result = await setSessionStatus(row.id, next);
      if ("error" in result) setError(result.error);
    });
  }

  const columns: Column<SessionRowData>[] = [
    {
      key: "scheduled_at",
      label: "Fecha",
      render: (r) => (
        <span
          style={{
            color: "var(--kg-text-1)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {formatDateTime(r.scheduledAt)}
        </span>
      ),
    },
    {
      key: "owner",
      label: "Dueño",
      render: (r) => r.ownerName,
    },
    {
      key: "duration",
      label: "Duración",
      align: "right",
      numeric: true,
      render: (r) =>
        r.durationMinutes != null ? `${r.durationMinutes} min` : "—",
    },
    {
      key: "assignees",
      label: "Asignados",
      render: (r) =>
        r.assignees.length === 0 ? (
          <span style={{ color: "var(--kg-text-3)" }}>—</span>
        ) : (
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {r.assignees.map((a) => (
              <span
                key={`${a.personId}-${a.role}`}
                style={{
                  padding: "2px 8px",
                  borderRadius: 999,
                  background: "var(--kg-surface-2-solid)",
                  border: "1px solid var(--kg-border-subtle)",
                  fontSize: 11,
                  color: "var(--kg-text-2)",
                }}
                title={ROLE_LABEL[a.role]}
              >
                {a.personName}
                <span
                  style={{ color: "var(--kg-text-3)", marginLeft: 4 }}
                >
                  · {ROLE_LABEL[a.role]}
                </span>
              </span>
            ))}
          </div>
        ),
    },
    {
      key: "pieces",
      label: "Pieces",
      align: "right",
      numeric: true,
      render: (r) => (r.piecesCount === 0 ? "—" : String(r.piecesCount)),
    },
    {
      key: "status",
      label: "Estado",
      render: (r) => (
        <StatusPill
          text={SESSION_STATUS_LABEL[r.status]}
          tone={SESSION_STATUS_TONE[r.status]}
        />
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
          <StatusMenu
            current={r.status}
            onSelect={(next) => handleStatusChange(r, next)}
            disabled={pending}
          />
        </div>
      ),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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

      {view === "tabla" ? (
        <>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={() => setCreating({ open: true })}
              disabled={noOwners}
              className="kg-focus"
              style={{ ...primaryBtn, opacity: noOwners ? 0.5 : 1 }}
              title={
                noOwners
                  ? "Primero creá al menos un dueño en /marketing/duenos"
                  : undefined
              }
            >
              + Nueva sesión
            </button>
          </div>
          <KgDataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            totalCount={rows.length}
            emptyTitle="Sin sesiones planificadas"
            emptyHint="Creá una sesión y asignale las pieces que se van a grabar."
          />
        </>
      ) : (
        <KgCalendar
          year={year}
          month={month}
          baseHref={baseHref}
          preserveParams={preserveParams}
          eventsByDate={eventsByDate}
          onDaySelect={(k) => setDayDrawerKey(k)}
          trailingAction={
            <button
              type="button"
              onClick={() => setCreating({ open: true })}
              disabled={noOwners}
              className="kg-focus"
              style={{ ...primaryBtn, opacity: noOwners ? 0.5 : 1 }}
              title={
                noOwners
                  ? "Primero creá al menos un dueño en /marketing/duenos"
                  : undefined
              }
            >
              + Nueva sesión
            </button>
          }
        />
      )}

      <SessionFormDrawer
        mode="create"
        open={creating.open}
        onClose={() => setCreating({ open: false })}
        ownerOptions={ownerOptions}
        personOptions={personOptions}
        pieceOptions={pieceOptions}
      />

      <SessionFormDrawer
        mode="edit"
        open={editingId != null}
        onClose={() => setEditingId(null)}
        ownerOptions={ownerOptions}
        personOptions={personOptions}
        pieceOptions={pieceOptions}
        initial={editingInitial}
      />

      <Drawer
        open={dayDrawerKey != null}
        onClose={() => setDayDrawerKey(null)}
        title={
          dayDrawerKey != null ? `Sesiones del ${formatDay(dayDrawerKey)}` : ""
        }
        width={480}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {rowsOfDay.length === 0 ? (
            <div
              className="kg-t7"
              style={{
                padding: "12px 14px",
                borderRadius: "var(--kg-r-8)",
                background: "var(--kg-surface-2-solid)",
                border: "1px dashed var(--kg-border-subtle)",
                color: "var(--kg-text-3)",
                textAlign: "center",
              }}
            >
              Ninguna sesión programada este día.
            </div>
          ) : (
            rowsOfDay.map((r) => (
              <div
                key={r.id}
                style={{
                  padding: "10px 14px",
                  borderRadius: "var(--kg-r-8)",
                  background: "var(--kg-surface-2-solid)",
                  border: "1px solid var(--kg-border-subtle)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <div
                    className="kg-t6"
                    style={{
                      color: "var(--kg-text-1)",
                      fontWeight: 600,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {formatTime(r.scheduledAt)} · {r.ownerName}
                  </div>
                  <StatusPill
                    text={SESSION_STATUS_LABEL[r.status]}
                    tone={SESSION_STATUS_TONE[r.status]}
                  />
                </div>
                <div
                  className="kg-t7"
                  style={{ color: "var(--kg-text-3)" }}
                >
                  {r.piecesCount} piece{r.piecesCount === 1 ? "" : "s"}
                  {r.assignees.length > 0 && (
                    <> · {r.assignees.map((a) => a.personName).join(", ")}</>
                  )}
                  {r.location && <> · {r.location}</>}
                </div>
                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    onClick={() => {
                      setDayDrawerKey(null);
                      setEditingId(r.id);
                    }}
                    className="kg-focus"
                    style={rowBtn}
                  >
                    Editar
                  </button>
                </div>
              </div>
            ))
          )}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={() => {
                const preset = dayDrawerKey ?? undefined;
                setDayDrawerKey(null);
                setCreating({ open: true, presetDate: preset });
              }}
              disabled={noOwners}
              className="kg-focus"
              style={{ ...primaryBtn, opacity: noOwners ? 0.5 : 1 }}
            >
              + Nueva sesión este día
            </button>
          </div>
        </div>
      </Drawer>
    </div>
  );
}

function StatusMenu({
  current,
  onSelect,
  disabled,
}: {
  readonly current: RecordingSessionStatus;
  readonly onSelect: (next: RecordingSessionStatus) => void;
  readonly disabled: boolean;
}) {
  return (
    <select
      value={current}
      onChange={(e) => onSelect(e.target.value as RecordingSessionStatus)}
      disabled={disabled}
      aria-label="Cambiar estado"
      style={{
        padding: "4px 10px",
        borderRadius: 999,
        background: "transparent",
        border: "1px solid var(--kg-border-subtle)",
        color: "var(--kg-text-2)",
        fontSize: 11,
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        colorScheme: "dark",
      }}
    >
      {RECORDING_SESSION_STATUSES.map((s) => (
        <option key={s} value={s}>
          {SESSION_STATUS_LABEL[s]}
        </option>
      ))}
    </select>
  );
}

function toDateKey(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDay(key: string): string {
  const [y, m, d] = key.split("-");
  if (!y || !m || !d) return key;
  return `${d}/${m}/${y}`;
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
