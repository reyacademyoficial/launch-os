/**
 * Traductor de errores de Postgres al vocabulario de la UI de pasivos.
 *
 * CHECKs del schema 0068:
 *   - amount >= 0
 *   - liability_type IN (5 valores fijos)
 */

export interface LiabilityErrorLike {
  readonly code?: string | null;
  readonly message?: string | null;
  readonly details?: string | null;
}

export function translateLiabilityError(error: LiabilityErrorLike): string {
  const code = error.code ?? "";
  const message = error.message ?? "Error desconocido al guardar el pasivo.";

  if (code === "23514") {
    if (message.includes("liability_type")) {
      return "El tipo de pasivo elegido no es válido.";
    }
    return "El pasivo no cumple una restricción de validez. Revisá el monto.";
  }

  if (code === "23503") {
    return `Referencia inválida: ${error.details || message}`;
  }

  return message;
}
