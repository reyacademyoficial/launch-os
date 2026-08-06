"use client";

import Link from "next/link";
import { useState } from "react";

import { KgDataTable, type Column } from "@/components/kg/data-table";
import { StatusPill } from "@/components/kg/status-pill";

import { TeamFormDrawer, type TeamInitial } from "./team-form-drawer";

export interface TeamRowData {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly active: boolean;
  readonly activeMembersCount: number;
}

export function TeamsView({
  rows,
  totalCount,
}: {
  readonly rows: readonly TeamRowData[];
  readonly totalCount: number;
}) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const editing =
    editingId != null ? rows.find((r) => r.id === editingId) ?? null : null;
  const editingInitial: TeamInitial | undefined = editing
    ? {
        id: editing.id,
        name: editing.name,
        description: editing.description,
        active: editing.active,
      }
    : undefined;

  const columns: Column<TeamRowData>[] = [
    {
      key: "name",
      label: "Equipo",
      render: (r) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <Link
            href={`/organizacion/equipos/${r.id}`}
            className="kg-focus"
            style={{
              color: "var(--kg-text-1)",
              textDecoration: "none",
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            {r.name}
          </Link>
          {r.description && (
            <div
              className="kg-t7"
              style={{ color: "var(--kg-text-3)" }}
            >
              {r.description}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "members",
      label: "Miembros activos",
      align: "right",
      numeric: true,
      render: (r) =>
        r.activeMembersCount === 0 ? (
          <span style={{ color: "var(--kg-text-3)" }}>—</span>
        ) : (
          String(r.activeMembersCount)
        ),
    },
    {
      key: "status",
      label: "Estado",
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
        <button
          type="button"
          onClick={() => setEditingId(r.id)}
          className="kg-focus"
          style={rowBtn}
        >
          Editar
        </button>
      ),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="kg-focus"
          style={primaryBtn}
        >
          + Nuevo equipo
        </button>
      </div>

      <KgDataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        totalCount={totalCount}
        emptyTitle="Sin equipos cargados"
        emptyHint="Un equipo agrupa personas de la organización bajo una etiqueta común (Producto, Growth, Media Buying). Una persona puede pertenecer a varios equipos."
      />

      <TeamFormDrawer
        mode="create"
        open={creating}
        onClose={() => setCreating(false)}
      />

      <TeamFormDrawer
        mode="edit"
        open={editingId != null}
        onClose={() => setEditingId(null)}
        initial={editingInitial}
      />
    </div>
  );
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
