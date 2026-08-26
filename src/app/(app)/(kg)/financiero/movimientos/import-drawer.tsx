"use client";

import { useState } from "react";

import { ImportXlsxDrawer } from "@/components/kg/import-xlsx-drawer";

import {
  confirmMovementsImport,
  previewMovementsImport,
} from "./actions";
import type { BankOption } from "./movement-form-drawer";

/**
 * Trigger + drawer para importar bank_movements desde Excel.
 * Disabled si no hay bancos activos (el import matchea por nombre de banco).
 */
export function ImportMovementsButton({
  banks,
}: {
  readonly banks: readonly BankOption[];
}) {
  const [open, setOpen] = useState(false);
  const disabled = banks.length === 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="kg-focus hidden md:inline-block"
        style={{
          padding: "6px 14px",
          borderRadius: 999,
          background: "transparent",
          border: "1px solid var(--kg-border-subtle)",
          color: "var(--kg-text-2)",
          fontSize: 12,
          fontWeight: 700,
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1,
        }}
        title={
          disabled
            ? "Necesitás al menos un banco activo para importar movimientos"
            : "Importar movimientos desde Excel"
        }
      >
        Importar Excel
      </button>
      <ImportXlsxDrawer
        open={open}
        onClose={() => setOpen(false)}
        title="Importar movimientos"
        templateHref="/api/financiero/movimientos/template"
        templateDescription="Descargá la plantilla, completá una fila por movimiento y volvé a subirla. Las columnas obligatorias son Banco, Tipo (Entrada/Salida), Monto y Fecha. El nombre del banco tiene que coincidir con uno existente. Si cargás el Nº transacción del movimiento, después el drawer de conciliación va a auto-sugerir el gasto o factura que traiga ese mismo número."
        onPreview={(fd) => previewMovementsImport(null, fd)}
        onConfirm={(fd) => confirmMovementsImport(null, fd)}
      />
    </>
  );
}
