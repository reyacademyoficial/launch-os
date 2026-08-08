"use client";

import { useState } from "react";

import { AssetFormDrawer } from "./asset-form-drawer";

// Botón "+ Nuevo activo" + drawer. Vive como `actions` del Panel para
// alinear con la pestaña de Facturas.
export function NewAssetButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="kg-focus"
        style={{
          padding: "6px 14px",
          borderRadius: 999,
          background: "var(--kg-accent-500)",
          color: "#fff",
          border: "none",
          fontSize: 12,
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        + Nuevo activo
      </button>
      <AssetFormDrawer
        mode="create"
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
