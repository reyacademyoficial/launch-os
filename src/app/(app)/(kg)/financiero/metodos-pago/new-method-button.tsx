"use client";

import { useState } from "react";

import {
  PaymentMethodFormDrawer,
  type BankOption,
  type ProjectOption,
} from "./payment-method-form-drawer";

// Botón "+ Nuevo método" + drawer. Se pasa como `actions` del Panel (patrón
// Facturas) — reemplaza la franja aparte que vivía dentro de MetodosPagoView.
export function NewPaymentMethodButton({
  projects,
  banks,
}: {
  readonly projects: readonly ProjectOption[];
  readonly banks: readonly BankOption[];
}) {
  const [open, setOpen] = useState(false);
  const disabled = projects.length === 0;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="kg-focus"
        style={{
          padding: "6px 14px",
          borderRadius: 999,
          background: "var(--kg-accent-500)",
          color: "#fff",
          border: "none",
          fontSize: 12,
          fontWeight: 700,
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1,
        }}
        title={
          disabled
            ? "Necesitás al menos un proyecto para crear un método"
            : "Crear un método de pago"
        }
      >
        + Nuevo método
      </button>
      <PaymentMethodFormDrawer
        mode="create"
        open={open}
        onClose={() => setOpen(false)}
        projects={projects}
        banks={banks}
      />
    </>
  );
}
