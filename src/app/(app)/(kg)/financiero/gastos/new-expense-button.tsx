"use client";

import { useState } from "react";

import { ExpenseFormDrawer } from "./expense-form-drawer";

// Botón "+ Nuevo gasto" + drawer de creación. Vive suelto para poder pasarse
// como `actions` del Panel (junto al título) y no ocupar una franja aparte
// dentro de GastosView — mismo criterio que NewInvoiceButton.
export function NewExpenseButton() {
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
      >
        + Nuevo gasto
      </button>
      <ExpenseFormDrawer
        mode="create"
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
