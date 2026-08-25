"use client";

import { useState } from "react";

import { KgDataTable, type Column } from "@/components/kg/data-table";
import { StatusPill } from "@/components/kg/status-pill";
import {
  FORMAT_LABEL,
  PLATFORM_LABEL,
  type MarketingFormat,
  type MarketingPlatform,
} from "@/lib/marketing/types";

import {
  CadenceFormDrawer,
  type CadenceInitial,
  type OwnerOption,
} from "./cadence-form-drawer";

// ═══════════════════════════════════════════════════════════════════════════
// Tabla de cadencias. Cada fila = (owner, platform, format) con
// posts_per_day y allow_repeat_asset. Editar dispara drawer con los 3
// campos del key en readOnly.
// ═══════════════════════════════════════════════════════════════════════════

export interface CadenceRowData {
  readonly contentOwnerId: string;
  readonly ownerName: string;
  readonly platform: MarketingPlatform;
  readonly format: MarketingFormat;
  readonly postsPerDay: number;
  readonly allowRepeatAsset: boolean;
  readonly notes: string | null;
}

export function CadenciasView({
  rows,
  ownerOptions,
}: {
  readonly rows: readonly CadenceRowData[];
  readonly ownerOptions: readonly OwnerOption[];
}) {
  const [editingKey, setEditingKey] = useState<string | null>(null);

  function rowKey(r: CadenceRowData): string {
    return `${r.contentOwnerId}::${r.platform}::${r.format}`;
  }

  const editing =
    editingKey != null ? rows.find((r) => rowKey(r) === editingKey) ?? null : null;
  const editingInitial: CadenceInitial | undefined =
    editing != null
      ? {
          contentOwnerId: editing.contentOwnerId,
          platform: editing.platform,
          format: editing.format,
          postsPerDay: editing.postsPerDay,
          allowRepeatAsset: editing.allowRepeatAsset,
          notes: editing.notes,
        }
      : undefined;

  const columns: Column<CadenceRowData>[] = [
    {
      key: "owner",
      label: "Dueño",
      render: (r) => (
        <span style={{ color: "var(--kg-text-1)", fontWeight: 600 }}>
          {r.ownerName}
        </span>
      ),
    },
    {
      key: "platform",
      label: "Plataforma",
      render: (r) => PLATFORM_LABEL[r.platform],
    },
    {
      key: "format",
      label: "Formato",
      render: (r) => FORMAT_LABEL[r.format],
    },
    {
      key: "posts_per_day",
      label: "Posts/día",
      align: "right",
      numeric: true,
      render: (r) => String(r.postsPerDay),
    },
    {
      key: "allow_repeat",
      label: "Reciclar asset",
      render: (r) => (
        <StatusPill
          text={r.allowRepeatAsset ? "Sí" : "No"}
          tone={
            r.allowRepeatAsset
              ? "var(--kg-accent-500)"
              : "var(--kg-neutral-500)"
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
            onClick={() => setEditingKey(rowKey(r))}
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

  const noOwners = ownerOptions.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <KgDataTable
        columns={columns}
        rows={rows}
        rowKey={rowKey}
        totalCount={rows.length}
        emptyTitle="Sin cadencias configuradas"
        emptyHint={
          noOwners
            ? "Primero creá dueños en la pestaña Dueños."
            : "Definí cuántos posts por día publicás para cada dueño × plataforma × formato. El módulo Stock usa esto para calcular días de cobertura."
        }
        fillHeight
      />

      <CadenceFormDrawer
        mode="edit"
        open={editingKey != null}
        onClose={() => setEditingKey(null)}
        ownerOptions={ownerOptions}
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
