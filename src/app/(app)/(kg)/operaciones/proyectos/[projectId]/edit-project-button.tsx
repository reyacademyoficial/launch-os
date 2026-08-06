"use client";

import { useState } from "react";

import {
  InternalProjectFormDrawer,
  type OwnerOption,
  type ProjectInitial,
} from "../internal-project-form-drawer";

// ═══════════════════════════════════════════════════════════════════════════
// Botón "Editar" para la ficha del proyecto. Estado local del drawer.
// Reusa el mismo drawer que la vista de listado.
// ═══════════════════════════════════════════════════════════════════════════

export function EditProjectButton({
  owners,
  initial,
}: {
  readonly owners: readonly OwnerOption[];
  readonly initial: ProjectInitial;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="kg-focus"
        style={{
          padding: "8px 16px",
          borderRadius: 999,
          background: "var(--kg-accent-500)",
          border: "none",
          color: "#fff",
          fontSize: 12,
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        Editar
      </button>
      <InternalProjectFormDrawer
        mode="edit"
        open={open}
        onClose={() => setOpen(false)}
        owners={owners}
        initial={initial}
      />
    </>
  );
}
