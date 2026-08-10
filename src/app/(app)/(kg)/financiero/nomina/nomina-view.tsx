"use client";

import { useState, useTransition } from "react";

import { KgDataTable, type Column } from "@/components/kg/data-table";
import { fMoney } from "@/lib/finance/format";

import { deletePayroll } from "./actions";
import {
  LinkPaymentDrawer,
  type UnconciledMovement,
} from "./link-payment-drawer";
import {
  PayrollFormDrawer,
  type PersonOption,
} from "./payroll-form-drawer";

// ═══════════════════════════════════════════════════════════════════════════
// Shape serializable — igual criterio que GastosView, todos los datos
// derivados los hace la page (server), este cliente solo compone y maneja
// el estado del drawer.
// ═══════════════════════════════════════════════════════════════════════════

export interface PayrollRowData {
  readonly id: string;
  readonly personId: string;
  readonly personName: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly baseSalary: number;
  readonly totalAmount: number;
  readonly currency: "ARS" | "USD";
  /** jsonb `extras` de payroll (0066) — {[label]: amount}. Vacío = sin extras. */
  readonly extras: Record<string, number>;
  readonly dueDate: string | null;
  readonly notes: string | null;
  readonly paidAt: string | null;
  readonly bankMovementId: string | null;
}

export function NominaView({
  rows,
  totalCount,
  people,
  unconciledMovements,
}: {
  readonly rows: readonly PayrollRowData[];
  readonly totalCount: number;
  readonly people: readonly PersonOption[];
  readonly unconciledMovements: readonly UnconciledMovement[];
}) {
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const linkingRow = linkingId
    ? rows.find((r) => r.id === linkingId) ?? null
    : null;
  const editingRow = editingId
    ? rows.find((r) => r.id === editingId) ?? null
    : null;

  const columns: Column<PayrollRowData>[] = [
    { key: "person", label: "Persona", render: (r) => r.personName },
    {
      key: "period",
      label: "Período",
      render: (r) => `${fmtDate(r.periodStart)} – ${fmtDate(r.periodEnd)}`,
    },
    {
      key: "base",
      label: "Base",
      align: "right",
      numeric: true,
      render: (r) => fMoney(r.baseSalary),
    },
    {
      key: "total",
      label: "Total",
      align: "right",
      numeric: true,
      render: (r) => fMoney(r.totalAmount),
    },
    {
      key: "due",
      label: "Vence",
      render: (r) => (r.dueDate ? fmtDate(r.dueDate) : "—"),
    },
    {
      key: "paid",
      label: "Estado",
      render: (r) => <PaidPill paidAt={r.paidAt} />,
    },
    {
      key: "actions",
      label: "",
      align: "right",
      render: (r) => (
        <RowActions
          row={r}
          onEdit={() => setEditingId(r.id)}
          onLink={() => setLinkingId(r.id)}
        />
      ),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <KgDataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        totalCount={totalCount}
        emptyTitle="No hay nómina cargada"
        emptyHint="Sin nómina cargada, el KPI Nómina del período queda en cero y el Burn mensual se subestima — el runway del dashboard sale inflado."
        maxBodyHeight="calc(100vh - 280px)"
      />

      {linkingRow && (
        <LinkPaymentDrawer
          payroll={{
            id: linkingRow.id,
            personName: linkingRow.personName,
            periodStart: linkingRow.periodStart,
            periodEnd: linkingRow.periodEnd,
            totalAmount: linkingRow.totalAmount,
            currency: linkingRow.currency,
            dueDate: linkingRow.dueDate,
            paidAt: linkingRow.paidAt,
            bankMovementId: linkingRow.bankMovementId,
          }}
          unconciledMovements={unconciledMovements}
          onClose={() => setLinkingId(null)}
        />
      )}

      {editingRow && (
        <PayrollFormDrawer
          mode="edit"
          open
          onClose={() => setEditingId(null)}
          people={people}
          initial={{
            id: editingRow.id,
            personId: editingRow.personId,
            periodStart: editingRow.periodStart,
            periodEnd: editingRow.periodEnd,
            baseSalary: editingRow.baseSalary,
            extras: editingRow.extras,
            currency: editingRow.currency,
            dueDate: editingRow.dueDate,
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
  onLink,
}: {
  readonly row: PayrollRowData;
  readonly onEdit: () => void;
  readonly onLink: () => void;
}) {
  const linked = row.paidAt != null && row.bankMovementId != null;
  const [deletePending, startDelete] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function handleDelete() {
    const label = `${row.personName} · ${fmtDate(row.periodStart)}–${fmtDate(row.periodEnd)}`;
    const msg = linked
      ? `¿Eliminar la liquidación "${label}"? Está vinculada a un movimiento bancario — vas a tener que desvincular primero desde "Ver pago".`
      : `¿Eliminar la liquidación "${label}"? Esta acción es irreversible.`;
    if (!confirm(msg)) return;
    setDeleteError(null);
    startDelete(async () => {
      const r = await deletePayroll(row.id);
      if ("error" in r) setDeleteError(r.error);
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
      {deleteError && (
        <span style={{ color: "#EF4444", fontSize: 10 }} title={deleteError}>
          ⚠
        </span>
      )}
      <button
        type="button"
        onClick={onEdit}
        className="kg-focus"
        style={ghostBtn}
        title="Editar liquidación"
      >
        Editar
      </button>
      <button
        type="button"
        onClick={onLink}
        className="kg-focus"
        style={{
          ...ghostBtn,
          color: linked ? "var(--kg-text-3)" : "var(--kg-accent-text)",
        }}
        title={linked ? "Ver / desvincular pago" : "Vincular pago"}
      >
        {linked ? "Ver pago" : "Vincular pago"}
      </button>
      <button
        type="button"
        onClick={handleDelete}
        disabled={deletePending}
        className="kg-focus"
        style={{
          ...ghostBtn,
          color: "#EF4444",
          cursor: deletePending ? "wait" : "pointer",
          opacity: deletePending ? 0.6 : 1,
        }}
        title="Borrar liquidación"
      >
        {deletePending ? "…" : "Borrar"}
      </button>
    </div>
  );
}

function PaidPill({ paidAt }: { readonly paidAt: string | null }) {
  const paid = paidAt != null;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px",
        borderRadius: 999,
        background: paid ? "rgba(0,208,132,0.15)" : "rgba(138,138,153,0.15)",
        color: paid ? "#00D084" : "var(--kg-text-2)",
        fontSize: 11,
        fontWeight: 700,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: paid ? "#00D084" : "#8A8A99",
          display: "inline-block",
        }}
      />
      {paid ? `Pagado ${fmtDate(paidAt!)}` : "Impago"}
    </span>
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
