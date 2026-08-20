"use client";

import { useState, useTransition } from "react";

import { KgDataTable, type Column } from "@/components/kg/data-table";
import {
  ASSET_TYPE_LABELS,
  isValidAssetType,
} from "@/lib/finance/asset-types";
import { fMoney } from "@/lib/finance/format";

import { setAssetActive } from "./actions";
import { AssetFormDrawer } from "./asset-form-drawer";

// ═══════════════════════════════════════════════════════════════════════════
// Shape serializable que llega desde la page (server component)
// ═══════════════════════════════════════════════════════════════════════════

export interface AssetRowData {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly description: string | null;
  readonly amount: number;
  readonly original: number | null;
  readonly depreciation: number;
  readonly currency: string;
  readonly acquiredAt: string | null;
  readonly notes: string | null;
  readonly active: boolean;
}

export function ActivosView({
  rows,
  totalCount,
}: {
  readonly rows: readonly AssetRowData[];
  readonly totalCount: number;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingRow = editingId
    ? rows.find((r) => r.id === editingId) ?? null
    : null;

  const columns: Column<AssetRowData>[] = [
    { key: "name", label: "Nombre", render: (r) => r.name },
    {
      key: "type",
      label: "Tipo",
      render: (r) =>
        isValidAssetType(r.type) ? ASSET_TYPE_LABELS[r.type] : r.type,
    },
    {
      key: "amount",
      label: "Valor libros",
      align: "right",
      numeric: true,
      render: (r) => fMoney(r.amount),
    },
    {
      key: "original",
      label: "Costo original",
      align: "right",
      numeric: true,
      render: (r) => (r.original == null ? "—" : fMoney(r.original)),
    },
    {
      key: "depreciation",
      label: "Depreciación",
      align: "right",
      numeric: true,
      render: (r) => fMoney(r.depreciation),
    },
    {
      key: "acquired",
      label: "Adquisición",
      render: (r) => (r.acquiredAt ? fmtDate(r.acquiredAt) : "—"),
    },
    {
      key: "state",
      label: "Estado",
      render: (r) => <ActivePill active={r.active} />,
    },
    {
      key: "actions",
      label: "",
      align: "right",
      render: (r) => (
        <RowActions row={r} onEdit={() => setEditingId(r.id)} />
      ),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <KgDataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        totalCount={totalCount}
        emptyTitle="No hay activos registrados"
        emptyHint="Los activos alimentan la tarjeta Caja del dashboard (los tipo caja/banco) y el Patrimonio neto (la suma total). Sin activos cargados esos dos KPIs quedan vacíos."
        fillHeight
      />

      {editingRow && (
        <AssetFormDrawer
          mode="edit"
          open
          onClose={() => setEditingId(null)}
          initial={{
            id: editingRow.id,
            name: editingRow.name,
            assetType: editingRow.type,
            description: editingRow.description,
            amount: editingRow.amount,
            originalCost: editingRow.original,
            depreciation: editingRow.depreciation,
            currency: editingRow.currency,
            acquiredAt: editingRow.acquiredAt,
            notes: editingRow.notes,
          }}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Sub-componentes
// ═══════════════════════════════════════════════════════════════════════════

function RowActions({
  row,
  onEdit,
}: {
  readonly row: AssetRowData;
  readonly onEdit: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleToggle() {
    setError(null);
    startTransition(async () => {
      const r = await setAssetActive(row.id, !row.active);
      if ("error" in r) setError(r.error);
    });
  }

  return (
    <div
      style={{
        display: "inline-flex",
        gap: 6,
        justifyContent: "flex-end",
        alignItems: "center",
      }}
    >
      {error && (
        <span
          style={{ color: "#EF4444", fontSize: 10 }}
          title={error}
        >
          ⚠
        </span>
      )}
      <button
        type="button"
        onClick={onEdit}
        className="kg-focus"
        style={ghostBtn}
        title="Editar activo"
      >
        Editar
      </button>
      <button
        type="button"
        onClick={handleToggle}
        disabled={pending}
        className="kg-focus"
        style={{
          ...ghostBtn,
          color: row.active ? "#EF4444" : "#00D084",
          opacity: pending ? 0.6 : 1,
        }}
        title={row.active ? "Dar de baja" : "Reactivar"}
      >
        {pending ? "…" : row.active ? "Dar de baja" : "Reactivar"}
      </button>
    </div>
  );
}

const ghostBtn: React.CSSProperties = {
  padding: "4px 10px",
  borderRadius: 999,
  background: "transparent",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-2)",
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
};

function fmtDate(iso: string): string {
  const s = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00Z` : iso;
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function ActivePill({ active }: { readonly active: boolean }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px",
        borderRadius: 999,
        background: active
          ? "rgba(0,208,132,0.15)"
          : "rgba(138,138,153,0.15)",
        color: active ? "#00D084" : "var(--kg-text-2)",
        fontSize: 11,
        fontWeight: 700,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: active ? "#00D084" : "#8A8A99",
          display: "inline-block",
        }}
      />
      {active ? "Activo" : "Dado de baja"}
    </span>
  );
}
