"use client";

import { useState } from "react";

import { panelActionPrimaryBtn } from "@/components/kg/form-primitives";

import {
  EditFormDrawer,
  type OwnerOption,
  type PersonOption,
  type RawOption,
} from "./edit-form-drawer";

export function NewEditButton({
  ownerOptions,
  personOptions,
  rawOptions,
}: {
  readonly ownerOptions: readonly OwnerOption[];
  readonly personOptions: readonly PersonOption[];
  readonly rawOptions: readonly RawOption[];
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
        title={noOwners ? "Primero creá dueños en la pestaña Dueños." : undefined}
      >
        + Nueva edición
      </button>
      <EditFormDrawer
        mode="create"
        open={open}
        onClose={() => setOpen(false)}
        ownerOptions={ownerOptions}
        personOptions={personOptions}
        rawOptions={rawOptions}
      />
    </>
  );
}
