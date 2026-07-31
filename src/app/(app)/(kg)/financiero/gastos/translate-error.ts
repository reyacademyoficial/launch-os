/**
 * Traductor de errores de Postgres al vocabulario de la UI de gastos.
 *
 * Vive fuera de `actions.ts` porque ese archivo lleva `"use server"` y solo
 * puede exportar async. Además el aislamiento permite tests puros.
 *
 * Cases cubiertos:
 *   - 23514 `expenses_tax_within_gross` → IVA supera bruto. La validación
 *     del formulario ya lo bloquea, pero si un cliente mal-comportado
 *     manda igual, el CHECK de DB (0063 línea 75) es la defensa final.
 *   - 23503 FK inválida (bank_movement_id inexistente o borrado en carrera).
 *   - 23505 unique_violation (no aplica hoy en expenses, pero por si futuro).
 *   - Cualquier otro → propagar mensaje original (mejor técnico que silencio).
 */

export interface ExpenseErrorLike {
  readonly code?: string | null;
  readonly message?: string | null;
  readonly details?: string | null;
}

export function translateExpenseError(error: ExpenseErrorLike): string {
  const code = error.code ?? "";
  const message = error.message ?? "Error desconocido al guardar el gasto.";
  const details = error.details ?? "";

  if (code === "23514") {
    if (message.includes("expenses_tax_within_gross")) {
      return "El IVA no puede superar el monto bruto del gasto.";
    }
    // Otros CHECK del schema (amount_gross >= 0, tax_amount >= 0)
    return "El gasto no cumple una restricción de validez. Revisá los montos.";
  }

  if (code === "23503") {
    // FK violation — el movimiento bancario que elegiste dejó de existir.
    if (message.includes("bank_movement_id")) {
      return (
        "El movimiento bancario elegido ya no existe. Recargá la lista y " +
        "volvé a intentar."
      );
    }
    return `Referencia inválida: ${details || message}`;
  }

  if (code === "23505") {
    return "Ya existe un registro con esos datos.";
  }

  return message;
}
