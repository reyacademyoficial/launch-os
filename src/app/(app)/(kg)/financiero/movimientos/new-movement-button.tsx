"use client";

import { useState } from "react";

import {
  MovementFormDrawer,
  type BankOption,
} from "./movement-form-drawer";

// Botón "+ Nuevo movimiento" + drawer de creación. Se pasa como `actions`
// del Panel para alinear el layout con la pestaña de Facturas.
export function NewMovementButton({
  banks,
}: {
  readonly banks: readonly BankOption[];
}) {
  const [open, setOpen] = useState(false);
  const disabled = banks.length === 0;
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
            ? "Necesitás al menos un banco activo para cargar movimientos"
            : "Crear un movimiento"
        }
      >
        + Nuevo movimiento
      </button>
      <MovementFormDrawer
        mode="create"
        open={open}
        onClose={() => setOpen(false)}
        banks={banks}
      />
    </>
  );
}
