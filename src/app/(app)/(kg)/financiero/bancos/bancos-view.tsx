"use client";

import { useState, useTransition } from "react";

import { KgDataTable, type Column } from "@/components/kg/data-table";
import { fmtNative, fmtUsd } from "@/lib/money";

import { setBankActive } from "./actions";
import { BankFormDrawer } from "./bank-form-drawer";

export interface BankRowData {
  readonly id: string;
  readonly name: string;
  readonly currency: "ARS" | "USD";
  readonly openingBalance: number;
  readonly fromPayments: number;
  readonly movementsIn: number;
  readonly movementsOut: number;
  readonly total: number;
  /** Equivalente USD. Para bancos USD = total; para ARS = total / última tasa; null si no hay tasa. */
  readonly totalUsd: number | null;
  readonly active: boolean;
}

export function BancosView({
  rows,
  totalCount,
}: {
  readonly rows: readonly BankRowData[];
  readonly totalCount: number;
}) {
  const [openCreate, setOpenCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingRow = editingId
    ? rows.find((r) => r.id === editingId) ?? null
    : null;

  const columns: Column<BankRowData>[] = [
    { key: "name", label: "Nombre", render: (r) => r.name },
    {
      key: "currency",
      label: "Moneda",
      render: (r) => r.currency,
    },
    {
      key: "opening",
      label: "Saldo inicial",
      align: "right",
      numeric: true,
      render: (r) => fmtNative(r.openingBalance, r.currency),
    },
    {
      key: "in",
      label: "Cobros",
      align: "right",
      numeric: true,
      render: (r) => fmtNative(r.fromPayments, r.currency),
    },
    {
      key: "mvIn",
      label: "Movim. +",
      align: "right",
      numeric: true,
      render: (r) => fmtNative(r.movementsIn, r.currency),
    },
    {
      key: "mvOut",
      label: "Movim. −",
      align: "right",
      numeric: true,
      render: (r) => fmtNative(-r.movementsOut, r.currency),
    },
    {
      key: "total",
      label: "Saldo total",
      align: "right",
      numeric: true,
      render: (r) => fmtNative(r.total, r.currency),
    },
    {
      key: "totalUsd",
      label: "Equiv. USD",
      align: "right",
      numeric: true,
      render: (r) =>
        r.currency === "USD"
          ? "—"
          : r.totalUsd !== null
            ? fmtUsd(r.totalUsd)
            : "sin tasa",
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
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          padding: "10px 14px",
          borderBottom: "1px solid var(--kg-border-subtle)",
        }}
      >
        <button
          type="button"
          onClick={() => setOpenCreate(true)}
          className="kg-focus"
          style={{
            padding: "6px 14px",
            borderRadius: 999,
            background: "var(--kg-accent-500)",
            color: "#fff",
            border: "none",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          + Nuevo banco
        </button>
      </div>

      <KgDataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        totalCount={totalCount}
        emptyTitle="No hay bancos registrados"
        emptyHint="Los bancos son las cuentas donde Kingrow deposita cobros. Cada método de pago se enlaza a un banco desde Métodos de pago. El saldo se calcula: saldo inicial + cobros vía métodos + movimientos manuales de entrada − movimientos manuales de salida."
      />

      <BankFormDrawer
        mode="create"
        open={openCreate}
        onClose={() => setOpenCreate(false)}
      />

      {editingRow && (
        <BankFormDrawer
          mode="edit"
          open
          onClose={() => setEditingId(null)}
          initial={{
            id: editingRow.id,
            name: editingRow.name,
            openingBalance: editingRow.openingBalance,
            currency: editingRow.currency,
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
  readonly row: BankRowData;
  readonly onEdit: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleToggle() {
    setError(null);
    startTransition(async () => {
      const r = await setBankActive(row.id, !row.active);
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
        title="Editar banco"
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
