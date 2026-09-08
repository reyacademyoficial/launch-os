"use client";

import { useState } from "react";

import { KgDataTable, type Column } from "@/components/kg/data-table";
import { FORMAT_LABEL, type MarketingFormat } from "@/lib/marketing/types";

import {
  FormatCapacityFormDrawer,
  type FormatCapacityInitial,
  type PersonOption,
} from "./format-capacity-form-drawer";

export interface FormatCapacityRowData {
  readonly personId: string;
  readonly personName: string;
  readonly format: MarketingFormat;
  readonly maxPerDay: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Tabla de editor_format_capacity — el tope alternativo por formato que
// alimenta el cálculo de capacidad diaria (fracción de día por edición).
// ═══════════════════════════════════════════════════════════════════════════

export function FormatCapacityView({
  rows,
  personOptions,
}: {
  readonly rows: readonly FormatCapacityRowData[];
  readonly personOptions: readonly PersonOption[];
}) {
  const [editingKey, setEditingKey] = useState<string | null>(null);

  function rowKey(r: FormatCapacityRowData): string {
    return `${r.personId}::${r.format}`;
  }

  const editing =
    editingKey != null ? rows.find((r) => rowKey(r) === editingKey) ?? null : null;
  const editingInitial: FormatCapacityInitial | undefined =
    editing != null
      ? {
          personId: editing.personId,
          personName: editing.personName,
          format: editing.format,
          maxPerDay: editing.maxPerDay,
        }
      : undefined;

  const columns: Column<FormatCapacityRowData>[] = [
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
      key: "format",
      label: "Formato",
      render: (r) => FORMAT_LABEL[r.format],
    },
    {
      key: "max",
      label: "Máximo/día",
      align: "right",
      numeric: true,
      render: (r) => String(r.maxPerDay),
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
        rowKey={rowKey}
        totalCount={rows.length}
        emptyTitle="Sin capacidades configuradas"
        emptyHint="Definí cuánto puede terminar cada editor por formato en un día completo — se usa para calcular su carga diaria."
        fillHeight
      />

      <FormatCapacityFormDrawer
        mode="edit"
        open={editingKey != null}
        onClose={() => setEditingKey(null)}
        personOptions={personOptions}
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
