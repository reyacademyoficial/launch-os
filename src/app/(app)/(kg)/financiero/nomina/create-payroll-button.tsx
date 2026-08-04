"use client";

import { useState } from "react";

import {
  PayrollFormDrawer,
  type PersonOption,
} from "./payroll-form-drawer";

/**
 * Botón + drawer para cargar una nueva liquidación de nómina. La lista de
 * personas se pasa desde la page (server-side) para que RLS filtre antes de
 * llegar al cliente y no se filtren personas de otras orgs.
 */
export function CreatePayrollButton({
  people,
}: {
  readonly people: ReadonlyArray<PersonOption>;
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
        + Nueva liquidación
      </button>
      <PayrollFormDrawer
        mode="create"
        open={open}
        onClose={() => setOpen(false)}
        people={people}
      />
    </>
  );
}
