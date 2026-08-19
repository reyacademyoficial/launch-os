"use client";

import { useState } from "react";

import {
  PaymentMethodFormDrawer,
  type BankOption,
} from "./payment-method-form-drawer";

// Botón "+ Nuevo método" + drawer. Se pasa como `actions` del Panel (patrón
// Facturas) — reemplaza la franja aparte que vivía dentro de MetodosPagoView.
export function NewPaymentMethodButton({
  banks,
}: {
  readonly banks: readonly BankOption[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
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
        title="Crear un método de pago"
      >
        + Nuevo método
      </button>
      <PaymentMethodFormDrawer
        mode="create"
        open={open}
        onClose={() => setOpen(false)}
        banks={banks}
      />
    </>
  );
}
