"use client";

import { useState, useTransition } from "react";

import { KgDataTable, type Column } from "@/components/kg/data-table";
import { StatusPill } from "@/components/kg/status-pill";

import { deactivateOwner, reactivateOwner } from "./actions";
import { OwnerFormDrawer, type OwnerInitial } from "./owner-form-drawer";

// ═══════════════════════════════════════════════════════════════════════════
// Tabla de content_owners con drawer create/edit + toggle archivar/reactivar.
// Mismo shape que ClientesView.
// ═══════════════════════════════════════════════════════════════════════════

export interface OwnerRowData {
  readonly id: string;
  readonly name: string;
  readonly handleInstagram: string | null;
  readonly handleFacebook: string | null;
  readonly handleTiktok: string | null;
  readonly handleYoutube: string | null;
  readonly notes: string | null;
  readonly active: boolean;
  readonly cadencesCount: number;
}

export function DuenosView({
  rows,
  totalCount,
}: {
  readonly rows: readonly OwnerRowData[];
  readonly totalCount: number;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const editing =
    editingId != null ? rows.find((r) => r.id === editingId) ?? null : null;
  const editingInitial: OwnerInitial | undefined =
    editing != null
      ? {
          id: editing.id,
          name: editing.name,
          handleInstagram: editing.handleInstagram,
          handleFacebook: editing.handleFacebook,
          handleTiktok: editing.handleTiktok,
          handleYoutube: editing.handleYoutube,
          notes: editing.notes,
          active: editing.active,
        }
      : undefined;

  function handleToggleActive(row: OwnerRowData) {
    setError(null);
    startTransition(async () => {
      const result = row.active
        ? await deactivateOwner(row.id)
        : await reactivateOwner(row.id);
      if ("error" in result) setError(result.error);
    });
  }

  const columns: Column<OwnerRowData>[] = [
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
      key: "instagram",
      label: "Instagram",
      render: (r) => (r.handleInstagram ? `@${r.handleInstagram}` : "—"),
    },
    {
      key: "tiktok",
      label: "TikTok",
      render: (r) => (r.handleTiktok ? `@${r.handleTiktok}` : "—"),
    },
    {
      key: "youtube",
      label: "YouTube",
      render: (r) => (r.handleYoutube ? r.handleYoutube : "—"),
    },
    {
      key: "cadences",
      label: "Cadencias",
      align: "right",
      numeric: true,
      render: (r) => (r.cadencesCount === 0 ? "—" : String(r.cadencesCount)),
    },
    {
      key: "status",
      label: "Registro",
      render: (r) => (
        <StatusPill
          text={r.active ? "Activo" : "Archivado"}
          tone={
            r.active ? "var(--kg-positive-500)" : "var(--kg-neutral-500)"
          }
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
            title="Editar"
          >
            Editar
          </button>
          <button
            type="button"
            onClick={() => handleToggleActive(r)}
            disabled={pending}
            className="kg-focus"
            style={rowBtn}
            title={r.active ? "Archivar" : "Reactivar"}
          >
            {r.active ? "Archivar" : "Reactivar"}
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {error && (
        <div
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

      <KgDataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        totalCount={totalCount}
        emptyTitle="Sin dueños que coincidan con el filtro"
        emptyHint="Cambiá el filtro o creá un dueño nuevo."
        fillHeight
      />

      <OwnerFormDrawer
        mode="edit"
        open={editingId != null}
        onClose={() => setEditingId(null)}
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
