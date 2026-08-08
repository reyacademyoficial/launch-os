"use client";

import { useState } from "react";

import {
  InvoiceFormDrawer,
  type ProductOption,
  type ProjectOption,
} from "./invoice-form-drawer";

// ═══════════════════════════════════════════════════════════════════════════
// Botón "+ Nueva factura" + drawer de creación. Vive suelto para poder
// pasarse como `actions` del Panel (junto al título "Facturas emitidas") en
// lugar de ocupar una franja aparte dentro de FacturasView.
// ═══════════════════════════════════════════════════════════════════════════

export function NewInvoiceButton({
  projects,
  products,
}: {
  readonly projects: readonly ProjectOption[];
  readonly products: readonly ProductOption[];
}) {
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
        + Nueva factura
      </button>
      <InvoiceFormDrawer
        mode="create"
        open={open}
        onClose={() => setOpen(false)}
        projects={projects}
        products={products}
      />
    </>
  );
}
