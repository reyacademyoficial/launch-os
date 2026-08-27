"use client";

import { useState, useTransition } from "react";

import { KgDataTable, type Column } from "@/components/kg/data-table";
import { fmtNative, fmtUsd } from "@/lib/money";

import { setBankActive } from "./actions";
import {
  BankFormDrawer,
  type BankFormProject,
} from "./bank-form-drawer";

// GastosView / FacturasView pattern: la vista se encarga del edit drawer y
// de la tabla; el "+ Nuevo banco" vive en el header del Panel via `actions`
// (ver ./new-bank-button + ./page.tsx).

export interface BankRowData {
  readonly id: string;
  readonly name: string;
  readonly currency: "ARS" | "USD";
  readonly openingBalance: number;
  readonly movementsIn: number;
  readonly movementsOut: number;
  readonly total: number;
  /** Equivalente USD. Para bancos USD = total; para ARS = total / última tasa; null si no hay tasa. */
  readonly totalUsd: number | null;
  readonly active: boolean;
  readonly isExternalCollector: boolean;
  readonly externalProjectId: string | null;
  readonly externalProjectName: string | null;
}

export function BancosView({
  rows,
  totalCount,
  projects,
}: {
  readonly rows: readonly BankRowData[];
  readonly totalCount: number;
  readonly projects: ReadonlyArray<BankFormProject>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingRow = editingId
    ? rows.find((r) => r.id === editingId) ?? null
    : null;

  const columns: Column<BankRowData>[] = [
    {
      key: "name",
      label: "Nombre",
      render: (r) => (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          {r.name}
          {r.isExternalCollector && <ExternalPill name={r.externalProjectName} />}
        </span>
      ),
    },
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
    <>
      <KgDataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        totalCount={totalCount}
        emptyTitle="No hay bancos registrados"
        emptyHint="Los bancos son las cuentas donde Kingrow opera. El saldo se calcula: saldo inicial + movimientos de entrada − movimientos de salida. Los cobros de ventas NO alimentan el saldo — para que un cobro impacte el banco hay que cargar el movimiento correspondiente y vincular la factura por Nº de transacción."
      />

      {editingRow && (
        <BankFormDrawer
          mode="edit"
          open
          onClose={() => setEditingId(null)}
          projects={projects}
          initial={{
            id: editingRow.id,
            name: editingRow.name,
            openingBalance: editingRow.openingBalance,
            currency: editingRow.currency,
            isExternalCollector: editingRow.isExternalCollector,
            externalProjectId: editingRow.externalProjectId,
          }}
        />
      )}
    </>
  );
}

function ExternalPill({ name }: { readonly name: string | null }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px",
        borderRadius: 999,
        background: "rgba(245,158,11,0.15)",
        color: "#F59E0B",
        fontSize: 10,
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
      title="Este banco representa un canal de cobro de un cliente externo. Los cobros no impactan el saldo de Kingrow."
    >
      Externo · {name ?? "s/proyecto"}
    </span>
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
