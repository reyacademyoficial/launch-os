"use client";

import { useState } from "react";

import { panelActionPrimaryBtn } from "@/components/kg/form-primitives";

import {
  AvailabilityFormDrawer,
  type PersonOption,
} from "./availability-form-drawer";

export function NewAvailabilityButton({
  personOptions,
}: {
  readonly personOptions: readonly PersonOption[];
}) {
  const [open, setOpen] = useState(false);
  const noPersons = personOptions.length === 0;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={noPersons}
        className="kg-focus"
        style={{ ...panelActionPrimaryBtn, opacity: noPersons ? 0.5 : 1 }}
        title={
          noPersons ? "Primero cargá al menos una persona en la org." : undefined
        }
      >
        + Nuevo bloque
      </button>
      <AvailabilityFormDrawer
        mode="create"
        open={open}
        onClose={() => setOpen(false)}
        personOptions={personOptions}
      />
    </>
  );
}
