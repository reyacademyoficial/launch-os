"use client";

import { useState, useTransition } from "react";

import { KgDataTable, type Column } from "@/components/kg/data-table";
import { fmtNative } from "@/lib/money";

import { deletePaymentMethod, setPaymentMethodActive } from "./actions";
import {
  PaymentMethodFormDrawer,
  type BankOption,
} from "./payment-method-form-drawer";

export interface PaymentMethodRowData {
  readonly id: string;
  readonly name: string;
  readonly bankId: string | null;
  readonly bankName: string | null;
  readonly bankActive: boolean | null;
  /** Moneda efectiva: del banco si tiene, sino del método. Para render nativo. */
  readonly effectiveCurrency: "ARS" | "USD";
  /** Currency del método (nullable en DB, usado al editar). */
  readonly currency: "ARS" | "USD" | null;
  readonly amountCollected: number;
  /** Comisión pasarela acumulada — derivada del bridge factura↔movimiento (paso 5b). */
  readonly gatewayFeeAccumulated: number;
  readonly active: boolean;
}

export function MetodosPagoView({
  rows,
  totalCount,
  banks,
}: {
  readonly rows: readonly PaymentMethodRowData[];
  readonly totalCount: number;
  readonly banks: readonly BankOption[];
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingRow = editingId
    ? rows.find((r) => r.id === editingId) ?? null
    : null;

  const columns: Column<PaymentMethodRowData>[] = [
    { key: "name", label: "Método", render: (r) => r.name },
    {
      key: "bank",
      label: "Banco destino",
      render: (r) => {
        if (!r.bankId) {
          return (
            <span style={{ color: "#FFB800", fontSize: 12, fontWeight: 600 }}>
              Sin banco
            </span>
          );
        }
        return (
          <span>
            {r.bankName ?? "—"}
            {r.bankActive === false && (
              <span style={{ color: "var(--kg-text-3)", fontSize: 10.5 }}>
                {" "}(inactivo)
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: "collected",
      label: "Cobrado",
      align: "right",
      numeric: true,
      render: (r) => fmtNative(r.amountCollected, r.effectiveCurrency),
    },
    {
      key: "gateway_fee",
      label: "Comisión pasarela",
      align: "right",
      numeric: true,
      render: (r) =>
        r.gatewayFeeAccumulated > 0
          ? fmtNative(r.gatewayFeeAccumulated, r.effectiveCurrency)
          : "—",
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
      <KgDataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        totalCount={totalCount}
        emptyTitle="No hay métodos de pago cargados"
        emptyHint="El catálogo es de Kingrow: cada método (transferencia, Stripe, Mercado Pago, efectivo…) baja a todos los proyectos. El banco elegido recibe los cobros que entran por ese método."
        maxBodyHeight="calc(100vh - 230px)"
      />

      {editingRow && (
        <PaymentMethodFormDrawer
          mode="edit"
          open
          onClose={() => setEditingId(null)}
          banks={banks}
          initial={{
            id: editingRow.id,
            name: editingRow.name,
            bankId: editingRow.bankId,
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
  readonly row: PaymentMethodRowData;
  readonly onEdit: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleToggle() {
    setError(null);
    startTransition(async () => {
      const r = await setPaymentMethodActive(row.id, !row.active);
      if ("error" in r) setError(r.error);
    });
  }

  function handleDelete() {
    // Confirm nativo — para métodos NUEVOS sin cobros. La DB rechaza con
    // ON DELETE RESTRICT si hay payments, y translate-error avisa.
    if (
      !confirm(
        `¿Borrar el método "${row.name}"? Solo funciona si no tiene cobros — en ese caso desactivalo en lugar de borrar.`,
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await deletePaymentMethod(row.id);
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
        title="Editar método"
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
      {row.amountCollected === 0 && (
        // Delete solo visible si NO hay cobros — evita el flujo confuso de
        // "cliqueás borrar → DB lo rechaza". La DB sigue siendo la última
        // línea de defensa vía ON DELETE RESTRICT.
        <button
          type="button"
          onClick={handleDelete}
          disabled={pending}
          className="kg-focus"
          style={{
            ...ghostBtn,
            color: "#EF4444",
            opacity: pending ? 0.6 : 1,
          }}
          title="Borrar (solo si no tiene cobros)"
        >
          Borrar
        </button>
      )}
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
