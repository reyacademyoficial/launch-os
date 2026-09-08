"use client";

import { useMemo, useState, useTransition } from "react";

import { KgDataTable, type Column, type SortDir } from "@/components/kg/data-table";
import { KgDetailDrawer, type DetailField } from "@/components/kg/detail-drawer";
import { primaryBtn } from "@/components/kg/form-primitives";
import { StateDot } from "@/components/kg/state-dot";
import { compareSortValues, type SortValue } from "@/lib/kg/sort";

import {
  EditFormDrawer,
  type PersonOption,
  type RawOption,
} from "../edicion/edit-form-drawer";
import { reorderRaws } from "./actions";
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
  readonly createdAt: string;
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
  personOptions,
}: {
  readonly rows: readonly RawRowData[];
  readonly ownerOptions: readonly OwnerOption[];
  readonly sessionOptions: readonly SessionOption[];
  readonly personOptions: readonly PersonOption[];
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [creatingEditForId, setCreatingEditForId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [sortState, setSortState] = useState<{ key: string; dir: SortDir } | null>(
    null,
  );

  function sortValueFor(row: RawRowData, key: string): SortValue {
    switch (key) {
      case "name":
        return row.name;
      case "owner":
        return row.ownerName;
      case "session":
        return row.sessionLabel;
      case "created":
        return row.createdAt;
      case "edits":
        return row.editsCount;
      default:
        return null;
    }
  }

  const sortedRows = useMemo(() => {
    if (!sortState) return rows;
    const dirMul = sortState.dir === "asc" ? 1 : -1;
    return [...rows].sort(
      (a, b) =>
        compareSortValues(sortValueFor(a, sortState.key), sortValueFor(b, sortState.key)) *
        dirMul,
    );
  }, [rows, sortState]);

  function handleReorder(orderedIds: readonly string[]) {
    setError(null);
    startTransition(async () => {
      const result = await reorderRaws(orderedIds);
      if ("error" in result) setError(result.error);
    });
  }

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
      sortable: true,
      render: (r) => (
        <span style={{ color: "var(--kg-text-1)", fontWeight: 600 }}>
          {r.name}
        </span>
      ),
    },
    {
      key: "owner",
      label: "Dueño",
      sortable: true,
      render: (r) => r.ownerName,
    },
    {
      key: "session",
      label: "Sesión origen",
      sortable: true,
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
          onClick={(e) => e.stopPropagation()}
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
      key: "created",
      label: "Cargado",
      sortable: true,
      render: (r) => (
        <span style={{ color: "var(--kg-text-2)", fontVariantNumeric: "tabular-nums" }}>
          {formatDay(r.createdAt)}
        </span>
      ),
    },
    {
      key: "edits",
      label: "Ediciones",
      align: "right",
      numeric: true,
      sortable: true,
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
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}
        >
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

  const creatingEditFor =
    creatingEditForId != null
      ? rows.find((r) => r.id === creatingEditForId) ?? null
      : null;

  const rawOptionsForEdit: RawOption[] = creatingEditFor
    ? [
        {
          id: creatingEditFor.id,
          contentOwnerId: creatingEditFor.contentOwnerId,
          label: creatingEditFor.name,
        },
      ]
    : [];

  const viewing =
    viewingId != null ? rows.find((r) => r.id === viewingId) ?? null : null;

  const viewingFields: readonly DetailField[] =
    viewing != null
      ? [
          { label: "Dueño", value: viewing.ownerName },
          { label: "Sesión origen", value: viewing.sessionLabel },
          {
            label: "Link",
            value: (
              <a
                href={viewing.driveUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--kg-accent-text)", textDecoration: "none" }}
              >
                Abrir ↗
              </a>
            ),
          },
          { label: "Cargado", value: formatDay(viewing.createdAt) },
          { label: "Ediciones", value: String(viewing.editsCount) },
          { label: "Notas", value: viewing.notes },
        ]
      : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
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

      {sortState && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <span className="kg-t7" style={{ color: "var(--kg-text-3)", marginRight: 8 }}>
            Ordenado por columna — el orden manual queda pausado.
          </span>
          <button
            type="button"
            onClick={() => setSortState(null)}
            className="kg-focus"
            style={{ ...rowBtn, padding: "2px 8px" }}
          >
            Volver a orden manual
          </button>
        </div>
      )}

      <KgDataTable
        columns={columns}
        rows={sortedRows}
        rowKey={(r) => r.id}
        totalCount={rows.length}
        emptyTitle="Sin crudos cargados"
        emptyHint="Los crudos aparecen acá después de una grabación realizada, o se cargan sueltos. Desde acá se abre una edición."
        fillHeight
        sort={{
          key: sortState?.key ?? null,
          dir: sortState?.dir ?? "asc",
          onChange: (key, dir) => setSortState({ key, dir }),
        }}
        dragSort={{ active: sortState == null, onReorder: handleReorder, disabled: pending }}
        onRowClick={(r) => setViewingId(r.id)}
      />

      <KgDetailDrawer
        open={viewing != null}
        onClose={() => setViewingId(null)}
        onEdit={
          viewing != null
            ? () => {
                setViewingId(null);
                setEditingId(viewing.id);
              }
            : undefined
        }
        extraActions={
          viewing != null && (
            <button
              type="button"
              onClick={() => {
                setViewingId(null);
                setCreatingEditForId(viewing.id);
              }}
              className="kg-focus"
              style={primaryBtn}
              title="Crear una edición a partir de este crudo"
            >
              Nueva edición
            </button>
          )
        }
        title={viewing?.name ?? ""}
        subtitle={viewing?.ownerName}
        fields={viewingFields}
      />

      <RawFormDrawer
        mode="edit"
        open={editingId != null}
        onClose={() => setEditingId(null)}
        ownerOptions={ownerOptions}
        sessionOptions={sessionOptions}
        initial={editingInitial}
      />

      <EditFormDrawer
        mode="create"
        open={creatingEditForId != null}
        onClose={() => setCreatingEditForId(null)}
        ownerOptions={ownerOptions}
        personOptions={personOptions}
        rawOptions={rawOptionsForEdit}
        presetOwnerId={creatingEditFor?.contentOwnerId}
        presetRawId={creatingEditFor?.id}
        initialKey={creatingEditFor?.id}
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

function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}
