"use client";

import { useState } from "react";

import {
  BankFormDrawer,
  type BankFormProject,
} from "./bank-form-drawer";

// Botón "+ Nuevo banco" + drawer. Se pasa como `actions` del Panel para
// que quede en la misma fila que el título (patrón Facturas).
export function NewBankButton({
  projects,
}: {
  readonly projects: ReadonlyArray<BankFormProject>;
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
      >
        + Nuevo banco
      </button>
      <BankFormDrawer
        mode="create"
        open={open}
        onClose={() => setOpen(false)}
        projects={projects}
      />
    </>
  );
}
