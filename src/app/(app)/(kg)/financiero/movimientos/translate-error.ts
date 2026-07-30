/**
 * Traductor de errores Postgres para bank_movements.
 *
 * CHECKs del schema 0044:
 *   - kind in ('in', 'out')
 *   - amount > 0
 * FK:
 *   - bank_id references banks(id) on delete cascade
 * Post 0101 (RLS org-scope): superadmin escribe todo; el resto rebota RLS.
 */

export interface BankMovementErrorLike {
  readonly code?: string | null;
  readonly message?: string | null;
  readonly details?: string | null;
}

export function translateBankMovementError(
  error: BankMovementErrorLike,
): string {
  const code = error.code ?? "";
  const message = error.message ?? "Error desconocido al guardar el movimiento.";

  if (code === "23514") {
    if (message.includes("amount")) {
      return "El monto tiene que ser mayor a 0.";
    }
    if (message.includes("kind")) {
      return "El tipo del movimiento debe ser entrada o salida.";
    }
    return "El movimiento no cumple una restricción de validez.";
  }

  if (code === "23503") {
    if (message.includes("bank_id")) {
      return (
        "El banco elegido ya no existe. Recargá la lista y volvé a intentar."
      );
    }
    return `Referencia inválida: ${error.details || message}`;
  }

  return message;
}
