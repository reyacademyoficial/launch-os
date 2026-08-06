/**
 * Traductor de errores de Postgres al vocabulario de la UI de facturas.
 *
 * Vive fuera de `actions.ts` porque ese archivo lleva `"use server"` y sólo
 * puede exportar async. El aislamiento permite tests puros.
 *
 * Cases cubiertos:
 *   - 23514 `invoices_tax_within_gross` → IVA supera bruto.
 *   - 23514 `invoices_paid_at_matches_status` → paid_at vs status inconsistente.
 *   - 23503 FK inválida (project_id / sale_id / installment_id / product_id
 *     borrados en carrera).
 *   - 23505 unique_violation → invoice_number duplicado en la org, o dos
 *     facturas apuntando al mismo installment.
 *   - Cualquier otro → propagar mensaje original.
 */

export interface InvoiceErrorLike {
  readonly code?: string | null;
  readonly message?: string | null;
  readonly details?: string | null;
}

export function translateInvoiceError(error: InvoiceErrorLike): string {
  const code = error.code ?? "";
  const message = error.message ?? "Error desconocido al guardar la factura.";
  const details = error.details ?? "";

  if (code === "23514") {
    if (message.includes("invoices_tax_within_gross")) {
      return "El IVA no puede superar el monto bruto de la factura.";
    }
    if (message.includes("invoices_paid_at_matches_status")) {
      return "Estado y fecha de pago inconsistentes: 'cobrada' requiere fecha de pago; los demás estados no la aceptan.";
    }
    return "La factura no cumple una restricción de validez. Revisá los montos.";
  }

  if (code === "23503") {
    if (message.includes("project_id")) {
      return "El proyecto elegido ya no existe. Recargá la lista y volvé a intentar.";
    }
    if (message.includes("sale_id")) {
      return "La venta asociada ya no existe.";
    }
    if (message.includes("installment_id")) {
      return "La cuota asociada ya no existe.";
    }
    if (message.includes("product_id")) {
      return "El producto elegido ya no existe.";
    }
    return `Referencia inválida: ${details || message}`;
  }

  if (code === "23505") {
    if (message.includes("invoices_installment_uniq")) {
      return "Esa cuota ya tiene una factura emitida. Regenerá desde la ficha de la venta si querés reemplazarla.";
    }
    if (message.includes("invoices_org_number_uniq")) {
      return "Ya existe una factura con ese número en la organización.";
    }
    return "Ya existe un registro con esos datos.";
  }

  return message;
}
