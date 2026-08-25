"use client";

import { useState } from "react";

import { panelActionPrimaryBtn } from "@/components/kg/form-primitives";

import { PieceFormDrawer, type OwnerOption } from "./piece-form-drawer";

// Botón "+ Nueva planificación" + drawer create. Vive suelto para pasarse
// como `actions` del Panel — mismo patrón que NewExpenseButton en financiero.
// Sin owners no se puede crear (el CHECK/FK necesita content_owner_id).
export function NewPieceButton({
  ownerOptions,
}: {
  readonly ownerOptions: readonly OwnerOption[];
}) {
  const [open, setOpen] = useState(false);
  const noOwners = ownerOptions.length === 0;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={noOwners}
        className="kg-focus"
        style={{ ...panelActionPrimaryBtn, opacity: noOwners ? 0.5 : 1 }}
        title={
          noOwners
            ? "Primero creá al menos un dueño en /marketing/duenos"
            : undefined
        }
      >
        + Nueva planificación
      </button>
      <PieceFormDrawer
        mode="create"
        open={open}
        onClose={() => setOpen(false)}
        ownerOptions={ownerOptions}
      />
    </>
  );
}
