"use client";

import { useState } from "react";

import { panelActionPrimaryBtn } from "@/components/kg/form-primitives";

import { CadenceFormDrawer, type OwnerOption } from "./cadence-form-drawer";

export function NewCadenceButton({
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
        + Nueva cadencia
      </button>
      <CadenceFormDrawer
        mode="create"
        open={open}
        onClose={() => setOpen(false)}
        ownerOptions={ownerOptions}
      />
    </>
  );
}
