"use client";

import { useState } from "react";

import { KgDataTable, type Column } from "@/components/kg/data-table";
import { StateDot } from "@/components/kg/state-dot";

import {
  RawFormDrawer,
  type OwnerOption,
  type RawInitial,
  type SessionOption,
} from "./raw-form-drawer";

export interface RawRowData {
  readonly id: string;
  readonly contentOwnerId: string;
  readonly ownerName: string;
  readonly sourceRecordingSessionId: string | null;
  readonly sessionLabel: string | null;
  readonly name: string;
  readonly driveUrl: string;
  readonly notes: string | null;
  readonly editsCount: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Tabla plana de content_raws (Crudos) + drawer create/edit.
//
// La columna "Ediciones" es lo que le dice al operador si ese crudo ya tiene
// trabajo de edición abierto o cerrado — 0 significa "nadie tocó esto
// todavía", el mismo tipo de señal que usa PendingPiecesPanel en Grabación.
// ═══════════════════════════════════════════════════════════════════════════

export function CrudosView({
  rows,
  ownerOptions,
  sessionOptions,
}: {
  readonly rows: readonly RawRowData[];
  readonly ownerOptions: readonly OwnerOption[];
  readonly sessionOptions: readonly SessionOption[];
}) {
  const [editingId, setEditingId] = useState<string | null>(null);

  const editing =
    editingId != null ? rows.find((r) => r.id === editingId) ?? null : null;

  const editingInitial: RawInitial | undefined =
    editing != null
      ? {
          id: editing.id,
          contentOwnerId: editing.contentOwnerId,
          sourceRecordingSessionId: editing.sourceRecordingSessionId,
          name: editing.name,
          driveUrl: editing.driveUrl,
          notes: editing.notes,
        }
      : undefined;

  const columns: Column<RawRowData>[] = [
    {
      key: "name",
      label: "Nombre",
      render: (r) => (
        <span style={{ color: "var(--kg-text-1)", fontWeight: 600 }}>
          {r.name}
        </span>
      ),
    },
    {
      key: "owner",
      label: "Dueño",
      render: (r) => r.ownerName,
    },
    {
      key: "session",
      label: "Sesión origen",
      render: (r) =>
        r.sessionLabel ? (
          r.sessionLabel
        ) : (
          <span style={{ color: "var(--kg-text-3)" }}>Sin sesión</span>
        ),
    },
    {
      key: "drive",
      label: "Link",
      render: (r) => (
        <a
          href={r.driveUrl}
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
      ),
    },
    {
      key: "edits",
      label: "Ediciones",
      align: "right",
      numeric: true,
      render: (r) =>
        r.editsCount === 0 ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              color: "var(--kg-text-3)",
            }}
          >
            <StateDot tone="warning" />
            Sin editar
          </span>
        ) : (
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {r.editsCount}
          </span>
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
        emptyTitle="Sin crudos cargados"
        emptyHint="Los crudos aparecen acá después de una grabación realizada, o se cargan sueltos. Desde acá se abre una edición."
        fillHeight
      />

      <RawFormDrawer
        mode="edit"
        open={editingId != null}
        onClose={() => setEditingId(null)}
        ownerOptions={ownerOptions}
        sessionOptions={sessionOptions}
        initial={editingInitial}
      />
    </div>
  );
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
