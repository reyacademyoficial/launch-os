"use client";

import { useState } from "react";

import { panelActionPrimaryBtn } from "@/components/kg/form-primitives";

import { OwnerFormDrawer } from "./owner-form-drawer";

// Botón "+ Nuevo dueño" + drawer create. Vive suelto para pasarse como
// `actions` del Panel — mismo patrón que NewExpenseButton en financiero.
export function NewOwnerButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="kg-focus"
        style={panelActionPrimaryBtn}
      >
        + Nuevo dueño
      </button>
      <OwnerFormDrawer
        mode="create"
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
