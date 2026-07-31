"use client";

import { useState } from "react";

import { KgDataTable, type Column } from "@/components/kg/data-table";
import { fMoney } from "@/lib/finance/format";

import {
  MovementFormDrawer,
  type BankOption,
} from "./movement-form-drawer";

export interface MovementRowData {
  readonly id: string;
  readonly bankId: string;
  readonly bankName: string;
  readonly projectName: string;
  readonly kind: "in" | "out";
  readonly amount: number;
  readonly occurredAt: string;
  readonly description: string;
}

export function MovimientosView({
  rows,
  totalCount,
  banks,
}: {
  readonly rows: readonly MovementRowData[];
  readonly totalCount: number;
  readonly banks: readonly BankOption[];
}) {
  const [openCreate, setOpenCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingRow = editingId
    ? rows.find((r) => r.id === editingId) ?? null
    : null;

  const columns: Column<MovementRowData>[] = [
    { key: "date", label: "Fecha", render: (r) => fmtDate(r.occurredAt) },
    { key: "bank", label: "Banco", render: (r) => r.bankName },
    { key: "project", label: "Proyecto", render: (r) => r.projectName },
    {
      key: "kind",
      label: "Tipo",
      render: (r) => <KindPill kind={r.kind} />,
    },
    {
      key: "amount",
      label: "Monto",
      align: "right",
      numeric: true,
      // Salidas con signo negativo. El color va por la pill, no por el número.
      render: (r) => (r.kind === "out" ? fMoney(-r.amount) : fMoney(r.amount)),
    },
    {
      key: "description",
      label: "Descripción",
      render: (r) =>
        r.description ? (
          <span title={r.description} style={ellipsis}>
            {r.description}
          </span>
        ) : (
          "—"
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
          style={ghostBtn}
          title="Editar movimiento"
        >
          Editar
        </button>
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
          disabled={banks.length === 0}
          className="kg-focus"
          style={{
            padding: "6px 14px",
            borderRadius: 999,
            background: "var(--kg-accent-500)",
            color: "#fff",
            border: "none",
            fontSize: 12,
            fontWeight: 700,
            cursor: banks.length === 0 ? "not-allowed" : "pointer",
            opacity: banks.length === 0 ? 0.5 : 1,
          }}
          title={
            banks.length === 0
              ? "Necesitás al menos un banco activo para cargar movimientos"
              : "Crear un movimiento"
          }
        >
          + Nuevo movimiento
        </button>
      </div>

      <KgDataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        totalCount={totalCount}
        emptyTitle="No hay movimientos bancarios cargados"
        emptyHint="Los movimientos alimentan el KPI Flujo de caja del dashboard. Cobros de ventas NO se duplican acá — viven en payments; esta tabla es para ingresos/egresos manuales (gastos, retiros, transferencias, ajustes)."
      />

      <MovementFormDrawer
        mode="create"
        open={openCreate}
        onClose={() => setOpenCreate(false)}
        banks={banks}
      />

      {editingRow && (
        <MovementFormDrawer
          mode="edit"
          open
          onClose={() => setEditingId(null)}
          banks={banks}
          initial={{
            id: editingRow.id,
            bankId: editingRow.bankId,
            bankName: editingRow.bankName,
            kind: editingRow.kind,
            amount: editingRow.amount,
            occurredAt: editingRow.occurredAt,
            description: editingRow.description,
          }}
        />
      )}
    </div>
  );
}

const ellipsis: React.CSSProperties = {
  display: "inline-block",
  maxWidth: 360,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  verticalAlign: "middle",
};

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
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function KindPill({ kind }: { readonly kind: "in" | "out" }) {
  const positive = kind === "in";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px",
        borderRadius: 999,
        background: positive
          ? "rgba(0,208,132,0.15)"
          : "rgba(239,68,68,0.15)",
        color: positive ? "#00D084" : "#EF4444",
        fontSize: 11,
        fontWeight: 700,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: positive ? "#00D084" : "#EF4444",
          display: "inline-block",
        }}
      />
      {positive ? "Entrada" : "Salida"}
    </span>
  );
}
