"use client";

import { useState } from "react";

import { panelActionPrimaryBtn } from "@/components/kg/form-primitives";
import {
  SessionFormDrawer,
  type OwnerOption,
  type PersonOption,
  type PieceOption,
} from "@/components/marketing/session-form-drawer";

// Botón "+ Nueva sesión" + drawer create. Sin owners no se puede crear.
export function NewSessionButton({
  ownerOptions,
  personOptions,
  pieceOptions,
}: {
  readonly ownerOptions: readonly OwnerOption[];
  readonly personOptions: readonly PersonOption[];
  readonly pieceOptions: readonly PieceOption[];
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
        + Nueva sesión
      </button>
      <SessionFormDrawer
        mode="create"
        open={open}
        onClose={() => setOpen(false)}
        ownerOptions={ownerOptions}
        personOptions={personOptions}
        pieceOptions={pieceOptions}
      />
    </>
  );
}
