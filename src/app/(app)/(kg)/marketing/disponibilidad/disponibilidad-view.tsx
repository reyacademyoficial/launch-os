"use client";

import { useState } from "react";

import { KgDataTable, type Column } from "@/components/kg/data-table";
import { StatusPill } from "@/components/kg/status-pill";

import {
  AvailabilityFormDrawer,
  type AvailabilityInitial,
  type PersonOption,
} from "./availability-form-drawer";

export interface AvailabilityRowData {
  readonly id: string;
  readonly personId: string;
  readonly personName: string;
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly available: boolean;
  readonly notes: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Tabla plana de editor_availability + drawer create/edit.
// Sin acciones extra — solo editar y borrar (dentro del drawer).
// ═══════════════════════════════════════════════════════════════════════════

export function DisponibilidadView({
  rows,
  personOptions,
}: {
  readonly rows: readonly AvailabilityRowData[];
  readonly personOptions: readonly PersonOption[];
}) {
  const [editingId, setEditingId] = useState<string | null>(null);

  const editing =
    editingId != null ? rows.find((r) => r.id === editingId) ?? null : null;

  const editingInitial: AvailabilityInitial | undefined =
    editing != null
      ? {
          id: editing.id,
          personId: editing.personId,
          dateFrom: editing.dateFrom,
          dateTo: editing.dateTo,
          available: editing.available,
          notes: editing.notes,
        }
      : undefined;

  const columns: Column<AvailabilityRowData>[] = [
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
      key: "range",
      label: "Rango",
      render: (r) => (
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          {formatDay(r.dateFrom)} → {formatDay(r.dateTo)}
        </span>
      ),
    },
    {
      key: "days",
      label: "Días",
      align: "right",
      numeric: true,
      render: (r) => String(daysBetween(r.dateFrom, r.dateTo)),
    },
    {
      key: "status",
      label: "Tipo",
      render: (r) => (
        <StatusPill
          text={r.available ? "Disponible" : "No disponible"}
          tone={
            r.available ? "var(--kg-positive-500)" : "var(--kg-negative-500)"
          }
        />
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
        emptyTitle="Sin bloques de disponibilidad cargados"
        emptyHint="Cargá bloques para que el planning semanal de edición muestre días disponibles por persona."
        fillHeight
      />

      <AvailabilityFormDrawer
        mode="edit"
        open={editingId != null}
        onClose={() => setEditingId(null)}
        personOptions={personOptions}
        initial={editingInitial}
      />
    </div>
  );
}

function formatDay(ymd: string): string {
  const [, m, d] = ymd.split("-");
  if (!m || !d) return ymd;
  return `${d}/${m}`;
}

function daysBetween(fromYmd: string, toYmd: string): number {
  const [fy, fm, fd] = fromYmd.split("-").map((n) => Number.parseInt(n, 10));
  const [ty, tm, td] = toYmd.split("-").map((n) => Number.parseInt(n, 10));
  if (![fy, fm, fd, ty, tm, td].every((v) => Number.isFinite(v))) return 0;
  const a = Date.UTC(fy!, fm! - 1, fd!);
  const b = Date.UTC(ty!, tm! - 1, td!);
  return Math.floor((b - a) / (24 * 60 * 60 * 1000)) + 1;
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
