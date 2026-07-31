/**
 * Traductor de errores Postgres para payment_methods.
 *
 * Casos cubiertos:
 *   - 23505 unique_violation → nombre duplicado dentro del proyecto.
 *   - 23503 FK — típicamente al borrar un método con cobros (payments tiene
 *     ON DELETE RESTRICT sobre payment_method_id). Mensaje empuja al toggle
 *     active en vez del delete para preservar histórico.
 *   - resto → mensaje original propagado.
 */

export interface PaymentMethodErrorLike {
  readonly code?: string | null;
  readonly message?: string | null;
  readonly details?: string | null;
}

export function translatePaymentMethodError(
  error: PaymentMethodErrorLike,
): string {
  const code = error.code ?? "";
  const message =
    error.message ?? "Error desconocido al guardar el método de pago.";

  if (code === "23505") {
    return "Ya existe un método con ese nombre en el proyecto.";
  }
  if (code === "23503") {
    // Casi seguro que es el RESTRICT de payments.payment_method_id.
    if (message.includes("payments")) {
      return (
        "El método tiene cobros asociados y no se puede borrar. Desactivalo " +
        "en vez de borrarlo para preservar el histórico."
      );
    }
    return `Referencia inválida: ${error.details || message}`;
  }
  return message;
}
