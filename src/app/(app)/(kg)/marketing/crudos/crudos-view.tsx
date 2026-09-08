"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

import { KgDataTable, type Column } from "@/components/kg/data-table";
import { KgDetailDrawer, type DetailField } from "@/components/kg/detail-drawer";
import { StateDot } from "@/components/kg/state-dot";

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
}: {
  readonly rows: readonly RawRowData[];
  readonly ownerOptions: readonly OwnerOption[];
  readonly sessionOptions: readonly SessionOption[];
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const router = useRouter();
  const searchParams = useSearchParams();
  const manualSort = searchParams?.get("sort") === "manual";

  function toggleManualSort(next: boolean) {
    const sp = new URLSearchParams(searchParams?.toString() ?? "");
    if (next) sp.set("sort", "manual");
    else sp.delete("sort");
    const qs = sp.toString();
    router.replace(qs ? `?${qs}` : "?", { scroll: false });
  }

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

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <label
          className="kg-t7"
          style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--kg-text-3)" }}
        >
          <input
            type="checkbox"
            checked={manualSort}
            onChange={(e) => toggleManualSort(e.target.checked)}
            style={{ accentColor: "var(--kg-accent-500)", cursor: "pointer" }}
          />
          Orden manual (arrastrar filas)
        </label>
      </div>

      <KgDataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        totalCount={rows.length}
        emptyTitle="Sin crudos cargados"
        emptyHint="Los crudos aparecen acá después de una grabación realizada, o se cargan sueltos. Desde acá se abre una edición."
        fillHeight
        dragSort={{ active: manualSort, onReorder: handleReorder, disabled: pending }}
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
