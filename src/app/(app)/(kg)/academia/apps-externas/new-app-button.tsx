"use client";

import { useState } from "react";

import { panelActionPrimaryBtn } from "@/components/kg/form-primitives";

import { AppFormOverlay, type ProjectOption } from "./view";

/**
 * Botón "+ Nueva app" + overlay create. Vive suelto para pasarse como
 * `actions` del Panel — patrón marketing.
 */
export function NewAppButton({
  projectOptions,
}: {
  readonly projectOptions: readonly ProjectOption[];
}) {
  const [open, setOpen] = useState(false);
  const disabled = projectOptions.length === 0;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="kg-focus"
        style={{ ...panelActionPrimaryBtn, opacity: disabled ? 0.5 : 1 }}
        title={disabled ? "Sin proyectos propios cargados" : "Registrar nueva app externa"}
      >
        + Nueva app
      </button>
      {open && (
        <AppFormOverlay
          mode="create"
          projectOptions={projectOptions}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
