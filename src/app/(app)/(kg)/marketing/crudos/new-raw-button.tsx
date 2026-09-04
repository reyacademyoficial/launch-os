"use client";

import { useState } from "react";

import { panelActionPrimaryBtn } from "@/components/kg/form-primitives";

import {
  RawFormDrawer,
  type OwnerOption,
  type SessionOption,
} from "./raw-form-drawer";

export function NewRawButton({
  ownerOptions,
  sessionOptions,
}: {
  readonly ownerOptions: readonly OwnerOption[];
  readonly sessionOptions: readonly SessionOption[];
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
        + Nuevo crudo
      </button>
      <RawFormDrawer
        mode="create"
        open={open}
        onClose={() => setOpen(false)}
        ownerOptions={ownerOptions}
        sessionOptions={sessionOptions}
      />
    </>
  );
}
