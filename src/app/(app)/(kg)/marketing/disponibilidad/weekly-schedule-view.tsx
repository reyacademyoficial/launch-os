"use client";

import { useState } from "react";

import { KgDataTable, type Column } from "@/components/kg/data-table";
import { WEEKDAY_LABEL, type Weekday } from "@/lib/marketing/types";

import {
  WeeklyScheduleFormDrawer,
  type PersonOption,
  type WeeklyScheduleInitial,
} from "./weekly-schedule-form-drawer";

export interface WeeklyScheduleRowData {
  readonly id: string;
  readonly personId: string;
  readonly personName: string;
  readonly dayOfWeek: Weekday;
  readonly startTime: string;
  readonly endTime: string;
  readonly notes: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Tabla de editor_weekly_schedule — la regla general de horario, no las
// excepciones (esas viven en DisponibilidadView / editor_availability).
// ═══════════════════════════════════════════════════════════════════════════

export function WeeklyScheduleView({
  rows,
  personOptions,
}: {
  readonly rows: readonly WeeklyScheduleRowData[];
  readonly personOptions: readonly PersonOption[];
}) {
  const [editingId, setEditingId] = useState<string | null>(null);

  const editing =
    editingId != null ? rows.find((r) => r.id === editingId) ?? null : null;

  const editingInitial: WeeklyScheduleInitial | undefined =
    editing != null
      ? {
          id: editing.id,
          personId: editing.personId,
          personName: editing.personName,
          dayOfWeek: editing.dayOfWeek,
          startTime: editing.startTime,
          endTime: editing.endTime,
          notes: editing.notes,
        }
      : undefined;

  const columns: Column<WeeklyScheduleRowData>[] = [
    {
      key: "person",
      label: "Persona",
      render: (r) => (
        <span style={{ color: "var(--kg-text-1)", fontWeight: 600 }}>
          {r.personName}
        </span>
      ),
    },
    {
      key: "day",
      label: "Día",
      render: (r) => WEEKDAY_LABEL[r.dayOfWeek],
    },
    {
      key: "hours",
      label: "Horario",
      render: (r) => (
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          {formatTime(r.startTime)} – {formatTime(r.endTime)}
        </span>
      ),
    },
    {
      key: "notes",
      label: "Notas",
      render: (r) =>
        r.notes ? (
          <span
            style={{
              color: "var(--kg-text-2)",
              maxWidth: 240,
              display: "inline-block",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={r.notes}
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
            className="kg-focus"
            style={rowBtn}
          >
            Editar
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <KgDataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        totalCount={rows.length}
        emptyTitle="Sin horario semanal configurado"
        emptyHint="Definí qué días y en qué franja horaria trabaja cada editor — se usa para calcular su capacidad diaria en Edición."
      />

      <WeeklyScheduleFormDrawer
        mode="edit"
        open={editingId != null}
        onClose={() => setEditingId(null)}
        personOptions={personOptions}
        initial={editingInitial}
      />
    </div>
  );
}

function formatTime(t: string): string {
  const [h, m] = t.split(":");
  if (!h || !m) return t;
  return `${h}:${m}`;
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
