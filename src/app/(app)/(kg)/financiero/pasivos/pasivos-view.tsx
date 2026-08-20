"use client";

import { useState, useTransition } from "react";

import { KgDataTable, type Column } from "@/components/kg/data-table";
import {
  LIABILITY_TYPE_LABELS,
  isValidLiabilityType,
} from "@/lib/finance/liability-types";
import { fMoney } from "@/lib/finance/format";

import { setLiabilityActive } from "./actions";
import { LiabilityFormDrawer } from "./liability-form-drawer";

export interface LiabilityRowData {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly description: string | null;
  readonly amount: number;
  readonly currency: string;
  readonly incurredAt: string | null;
  readonly dueDate: string | null;
  readonly settledAt: string | null;
  readonly notes: string | null;
  readonly active: boolean;
}

export function PasivosView({
  rows,
  totalCount,
}: {
  readonly rows: readonly LiabilityRowData[];
  readonly totalCount: number;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingRow = editingId
    ? rows.find((r) => r.id === editingId) ?? null
    : null;

  const columns: Column<LiabilityRowData>[] = [
    { key: "name", label: "Nombre", render: (r) => r.name },
    {
      key: "type",
      label: "Tipo",
      render: (r) =>
        isValidLiabilityType(r.type) ? LIABILITY_TYPE_LABELS[r.type] : r.type,
    },
    {
      key: "amount",
      label: "Monto",
      align: "right",
      numeric: true,
      render: (r) => fMoney(r.amount),
    },
    {
      key: "incurred",
      label: "Incurrido",
      render: (r) => (r.incurredAt ? fmtDate(r.incurredAt) : "—"),
    },
    {
      key: "due",
      label: "Vence",
      render: (r) => (r.dueDate ? fmtDate(r.dueDate) : "—"),
    },
    {
      key: "state",
      label: "Estado",
      render: (r) => <StatePill row={r} />,
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
        emptyTitle="No hay pasivos registrados"
        emptyHint="Los pasivos vigentes (active=true AND settled_at IS NULL) restan del Patrimonio neto del dashboard. Sin pasivos cargados, el patrimonio se estima solo por activos + AP corriente."
        fillHeight
      />

      {editingRow && (
        <LiabilityFormDrawer
          mode="edit"
          open
          onClose={() => setEditingId(null)}
          initial={{
            id: editingRow.id,
            name: editingRow.name,
            liabilityType: editingRow.type,
            description: editingRow.description,
            amount: editingRow.amount,
            currency: editingRow.currency,
            incurredAt: editingRow.incurredAt,
            dueDate: editingRow.dueDate,
            settledAt: editingRow.settledAt,
            notes: editingRow.notes,
          }}
        />
      )}
    </div>
  );
}

function RowActions({
  row,
  onEdit,
}: {
  readonly row: LiabilityRowData;
  readonly onEdit: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleToggle() {
    setError(null);
    startTransition(async () => {
      const r = await setLiabilityActive(row.id, !row.active);
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
        <span style={{ color: "#EF4444", fontSize: 10 }} title={error}>
          ⚠
        </span>
      )}
      <button
        type="button"
        onClick={onEdit}
        className="kg-focus"
        style={ghostBtn}
        title="Editar pasivo"
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

function StatePill({
  row,
}: {
  readonly row: LiabilityRowData;
}) {
  let label: string;
  let bg: string;
  let fg: string;
  let dot: string;
  if (row.settledAt != null) {
    label = `Saldado ${fmtDate(row.settledAt)}`;
    bg = "rgba(0,208,132,0.15)";
    fg = "#00D084";
    dot = "#00D084";
  } else if (!row.active) {
    label = "Inactivo";
    bg = "rgba(138,138,153,0.15)";
    fg = "var(--kg-text-2)";
    dot = "#8A8A99";
  } else {
    label = "Vigente";
    bg = "rgba(255,184,0,0.15)";
    fg = "#FFB800";
    dot = "#FFB800";
  }
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px",
        borderRadius: 999,
        background: bg,
        color: fg,
        fontSize: 11,
        fontWeight: 700,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: dot,
          display: "inline-block",
        }}
      />
      {label}
    </span>
  );
}
