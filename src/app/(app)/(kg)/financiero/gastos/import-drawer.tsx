"use client";

import { useState } from "react";

import { ImportXlsxDrawer } from "@/components/kg/import-xlsx-drawer";

import {
  confirmExpensesImport,
  previewExpensesImport,
} from "./actions";

/**
 * Trigger + drawer para importar expenses desde Excel.
 * Los gastos se importan sin conciliar — paid_at y bank_movement_id quedan
 * en null; la vinculación al pago se hace después desde la fila.
 */
export function ImportExpensesButton() {
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
          background: "transparent",
          border: "1px solid var(--kg-border-subtle)",
          color: "var(--kg-text-2)",
          fontSize: 12,
          fontWeight: 700,
          cursor: "pointer",
        }}
        title="Importar gastos desde Excel"
      >
        Importar Excel
      </button>
      <ImportXlsxDrawer
        open={open}
        onClose={() => setOpen(false)}
        title="Importar gastos"
        templateHref="/api/financiero/gastos/template"
        templateDescription="Descargá la plantilla, completá una fila por gasto y volvé a subirla. Obligatorias: Descripción, Bruto y Fecha. Los gastos entran como impagos — para conciliarlos con un movimiento bancario usá el botón 'Vincular pago' en cada fila."
        onPreview={(fd) => previewExpensesImport(null, fd)}
        onConfirm={(fd) => confirmExpensesImport(null, fd)}
      />
    </>
  );
}
