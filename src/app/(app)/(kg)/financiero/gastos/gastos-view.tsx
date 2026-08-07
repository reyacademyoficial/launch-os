"use client";

import { useState, useTransition } from "react";

import { KgDataTable, type Column } from "@/components/kg/data-table";
import {
  EXPENSE_CATEGORY_LABELS,
  isValidExpenseCategory,
} from "@/lib/finance/expense-categories";
import { fMoney } from "@/lib/finance/format";

import { deleteExpense } from "./actions";
import { ExpenseFormDrawer } from "./expense-form-drawer";
import { ImportExpensesButton } from "./import-drawer";
import {
  LinkPaymentDrawer,
  type UnconciledMovement,
} from "./link-payment-drawer";

// ═══════════════════════════════════════════════════════════════════════════
// Shape serializable que llega desde la page (server component)
// ═══════════════════════════════════════════════════════════════════════════

export interface ExpenseRowData {
  readonly id: string;
  readonly expenseDate: string;
  readonly description: string;
  readonly category: string | null;
  readonly supplier: string;
  readonly amountGross: number;
  readonly taxAmount: number;
  readonly amountNet: number;
  readonly currency: string;
  readonly dueDate: string | null;
  readonly paidAt: string | null;
  readonly bankMovementId: string | null;
  readonly notes: string | null;
  readonly transactionNumber: string | null;
  readonly linkedMovements: ReadonlyArray<{
    readonly movementId: string;
    readonly role: "principal" | "comision" | "otro";
    readonly amount: number;
    readonly kind: "in" | "out";
    readonly occurredAt: string;
    readonly description: string | null;
    readonly bankName: string;
  }>;
}

// ═══════════════════════════════════════════════════════════════════════════
// GastosView — envuelve la tabla + botón crear + drawers de edit/link
// ═══════════════════════════════════════════════════════════════════════════

export function GastosView({
  rows,
  totalCount,
  unconciledMovements,
  exportHref,
}: {
  readonly rows: readonly ExpenseRowData[];
  readonly totalCount: number;
  readonly unconciledMovements: readonly UnconciledMovement[];
  readonly exportHref: string;
}) {
  const [openCreate, setOpenCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [linkingId, setLinkingId] = useState<string | null>(null);

  const editingRow = editingId
    ? rows.find((r) => r.id === editingId) ?? null
    : null;
  const linkingRow = linkingId
    ? rows.find((r) => r.id === linkingId) ?? null
    : null;

  const columns: Column<ExpenseRowData>[] = [
    { key: "date", label: "Fecha", render: (r) => fmtDate(r.expenseDate) },
    {
      key: "description",
      label: "Descripción",
      render: (r) => (
        <span title={r.description} style={ellipsis}>
          {r.description}
        </span>
      ),
    },
    {
      key: "category",
      label: "Categoría",
      render: (r) => {
        if (!r.category) return "—";
        return isValidExpenseCategory(r.category)
          ? EXPENSE_CATEGORY_LABELS[r.category]
          : r.category;
      },
    },
    { key: "supplier", label: "Proveedor", render: (r) => r.supplier },
    {
      key: "gross",
      label: "Bruto",
      align: "right",
      numeric: true,
      render: (r) => fMoney(r.amountGross),
    },
    {
      key: "iva",
      label: "IVA",
      align: "right",
      numeric: true,
      render: (r) => fMoney(r.taxAmount),
    },
    {
      key: "net",
      label: "Neto",
      align: "right",
      numeric: true,
      render: (r) => fMoney(r.amountNet),
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
      key: "transaction_number",
      label: "Nº transacción",
      render: (r) =>
        r.transactionNumber ? (
          <span title={r.transactionNumber} style={ellipsis}>
            {r.transactionNumber}
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
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          padding: "10px 14px",
          borderBottom: "1px solid var(--kg-border-subtle)",
        }}
      >
        <a
          href={exportHref}
          className="kg-focus"
          style={ghostBtnLg}
          title="Exportar la vista actual a Excel"
        >
          Exportar Excel
        </a>
        <ImportExpensesButton />
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
          + Nuevo gasto
        </button>
      </div>

      <KgDataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        totalCount={totalCount}
        emptyTitle="No hay gastos cargados"
        emptyHint="Sin gastos cargados, los KPIs Gastos operativos, Utilidad neta y Burn del dashboard financiero quedan en cero. Los movimientos bancarios de salida (pestaña Movimientos) NO alimentan estos KPIs — cargar el gasto acá es lo que los hace visibles."
      />

      <ExpenseFormDrawer
        mode="create"
        open={openCreate}
        onClose={() => setOpenCreate(false)}
      />

      {editingRow && (
        <ExpenseFormDrawer
          mode="edit"
          open
          onClose={() => setEditingId(null)}
          initial={{
            id: editingRow.id,
            description: editingRow.description,
            category: editingRow.category,
            amountGross: editingRow.amountGross,
            taxAmount: editingRow.taxAmount,
            currency: editingRow.currency,
            expenseDate: editingRow.expenseDate,
            dueDate: editingRow.dueDate,
            notes: editingRow.notes,
            transactionNumber: editingRow.transactionNumber,
          }}
        />
      )}

      {linkingRow && (
        <LinkPaymentDrawer
          expense={{
            id: linkingRow.id,
            description: linkingRow.description,
            amountGross: linkingRow.amountGross,
            currency: linkingRow.currency,
            expenseDate: linkingRow.expenseDate,
            paidAt: linkingRow.paidAt,
            bankMovementId: linkingRow.bankMovementId,
            linkedMovements: linkingRow.linkedMovements,
          }}
          unconciledMovements={unconciledMovements}
          onClose={() => setLinkingId(null)}
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
  readonly row: ExpenseRowData;
  readonly onEdit: () => void;
  readonly onLink: () => void;
}) {
  const linked = row.paidAt != null && row.bankMovementId != null;
  const [deletePending, startDelete] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function handleDelete() {
    const msg = linked
      ? `¿Eliminar el gasto "${row.description}"? Está vinculado a un movimiento bancario — vas a tener que desvincular primero desde "Ver pago".`
      : `¿Eliminar el gasto "${row.description}"? Esta acción es irreversible.`;
    if (!confirm(msg)) return;
    setDeleteError(null);
    startDelete(async () => {
      const r = await deleteExpense(row.id);
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
        title="Editar gasto"
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
        title="Borrar gasto"
      >
        {deletePending ? "…" : "Borrar"}
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

const ghostBtnLg: React.CSSProperties = {
  padding: "6px 14px",
  borderRadius: 999,
  background: "transparent",
  border: "1px solid var(--kg-border-subtle)",
  color: "var(--kg-text-2)",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
};

const ellipsis: React.CSSProperties = {
  display: "inline-block",
  maxWidth: 280,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  verticalAlign: "middle",
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
