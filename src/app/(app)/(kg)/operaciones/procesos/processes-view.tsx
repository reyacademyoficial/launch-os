"use client";

import Link from "next/link";
import { useState } from "react";

import { KgDataTable, type Column } from "@/components/kg/data-table";
import { StatusPill } from "@/components/kg/status-pill";

import {
  ProcessFormDrawer,
  type ProcessInitial,
} from "./process-form-drawer";

export interface ProcessRowData {
  readonly id: string;
  readonly title: string;
  readonly slug: string | null;
  readonly contentMd: string;
  readonly category: string | null;
  readonly version: number;
  readonly active: boolean;
  readonly updatedAt: string;
}

export function ProcessesView({
  rows,
  totalCount,
}: {
  readonly rows: readonly ProcessRowData[];
  readonly totalCount: number;
}) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const editing =
    editingId != null ? rows.find((r) => r.id === editingId) ?? null : null;
  const editingInitial: ProcessInitial | undefined = editing
    ? {
        id: editing.id,
        title: editing.title,
        slug: editing.slug,
        contentMd: editing.contentMd,
        category: editing.category,
        version: editing.version,
        active: editing.active,
      }
    : undefined;

  const columns: Column<ProcessRowData>[] = [
    {
      key: "title",
      label: "Proceso",
      render: (r) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <Link
            href={`/operaciones/procesos/${r.id}`}
            className="kg-focus"
            style={{
              color: "var(--kg-text-1)",
              textDecoration: "none",
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            {r.title}
          </Link>
          {r.slug && (
            <div
              className="kg-t7"
              style={{
                color: "var(--kg-text-3)",
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
              }}
            >
              /{r.slug}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "category",
      label: "Categoría",
      render: (r) =>
        r.category ?? <span style={{ color: "var(--kg-text-3)" }}>—</span>,
    },
    {
      key: "version",
      label: "Versión",
      align: "right",
      numeric: true,
      render: (r) => `v${r.version}`,
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
      key: "updated",
      label: "Actualizado",
      render: (r) => formatDate(r.updatedAt),
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
          + Nuevo proceso
        </button>
      </div>

      <KgDataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        totalCount={totalCount}
        emptyTitle="Sin procesos cargados"
        emptyHint="Los procesos son SOPs documentados (Markdown) — onboarding, playbooks, checklists de cierre. Se organizan por categoría libre y se versionan a mano."
      />

      <ProcessFormDrawer
        mode="create"
        open={creating}
        onClose={() => setCreating(false)}
      />

      <ProcessFormDrawer
        mode="edit"
        open={editingId != null}
        onClose={() => setEditingId(null)}
        initial={editingInitial}
      />
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
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
