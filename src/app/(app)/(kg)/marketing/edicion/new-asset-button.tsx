"use client";

import { useState } from "react";

import { panelActionPrimaryBtn } from "@/components/kg/form-primitives";
import {
  ProductionBatchDrawer,
  type PersonOptionForBatch,
  type SessionOptionForBatch,
} from "@/components/marketing/production-batch-drawer";

// Botón "+ Registrar producción" en /marketing/edicion. Abre el batch drawer
// con dropdown de sesiones realizadas — el editor elige la sesión y carga
// los N cortes que salieron. Reemplazó al drawer single-asset porque el 99%
// del flujo es post-grabación (varios cortes por sesión). El edit-in-place
// de assets ya creados sigue disponible desde la fila de la tabla.
export function NewAssetButton({
  sessionOptions,
  personOptions,
}: {
  readonly sessionOptions: readonly SessionOptionForBatch[];
  readonly personOptions: readonly PersonOptionForBatch[];
}) {
  const [open, setOpen] = useState(false);
  const noSessions = sessionOptions.length === 0;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={noSessions}
        className="kg-focus"
        style={{ ...panelActionPrimaryBtn, opacity: noSessions ? 0.5 : 1 }}
        title={
          noSessions
            ? "Primero marcá una sesión de grabación como realizada en /marketing/grabacion"
            : undefined
        }
      >
        + Registrar producción
      </button>
      <ProductionBatchDrawer
        open={open}
        onClose={() => setOpen(false)}
        sessionOptions={sessionOptions}
        personOptions={personOptions}
      />
    </>
  );
}
