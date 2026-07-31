"use client";

import { useState, useTransition } from "react";

import { deactivatePerson, reactivatePerson } from "./actions";

/**
 * Toggle activo/inactivo. Desactivar tiene doble-tap para prevenir accidentes
 * (patrón calcado de DeactivateUserButton). Reactivar es un click solo — es
 * la operación reversible y de bajo impacto.
 *
 * No hay hard-delete: payroll (0066) y time_entries (0096) referencian con
 * ON DELETE RESTRICT, así que borrar una persona con historial rompería la FK.
 */
export function PersonActiveToggle({
  personId,
  active,
}: {
  readonly personId: string;
  readonly active: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (!active) {
    return (
      <button
        type="button"
        onClick={() =>
          startTransition(async () => {
            await reactivatePerson(personId);
          })
        }
        disabled={isPending}
        className="text-xs font-medium text-fg-muted hover:text-success disabled:opacity-50"
      >
        {isPending ? "Reactivando…" : "Reactivar"}
      </button>
    );
  }

  if (confirming) {
    return (
      <div className="inline-flex items-center gap-3 text-xs">
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={isPending}
          className="text-fg-muted hover:text-fg disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={() =>
            startTransition(async () => {
              await deactivatePerson(personId);
              setConfirming(false);
            })
          }
          disabled={isPending}
          className="font-medium text-error hover:opacity-80 disabled:opacity-50"
        >
          {isPending ? "Desactivando…" : "Confirmar"}
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="text-xs font-medium text-fg-muted hover:text-error"
    >
      Desactivar
    </button>
  );
}
