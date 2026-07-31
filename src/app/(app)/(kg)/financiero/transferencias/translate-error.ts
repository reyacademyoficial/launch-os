/**
 * Traductor de errores de la RPC 0102 `transfer_to_client` y de los CHECK/FK
 * del esquema de client_transfers.
 *
 * La RPC 0102 usa `raise ... using detail = ...` con marcadores explícitos
 * para que este traductor mapee sin depender del texto español del mensaje.
 * Los detalles definidos:
 *   - settlement-not-found
 *   - settlement-not-liquidada
 *   - project-not-external
 *   - no-pending-balance
 *   - bank-not-found
 *   - bank-org-mismatch
 */

export interface TransferErrorLike {
  readonly code?: string | null;
  readonly message?: string | null;
  readonly details?: string | null;
}

export function translateTransferError(error: TransferErrorLike): string {
  const detail = (error.details ?? "").trim();
  const message =
    error.message ?? "Error desconocido al transferir al cliente.";

  if (detail === "settlement-not-found") {
    return (
      "La liquidación ya no existe. Alguien puede haberla eliminado — " +
      "recargá y volvé a intentar."
    );
  }
  if (detail === "settlement-not-liquidada") {
    return (
      "Solo se pueden transferir liquidaciones en estado 'liquidada'. " +
      "Cerrala primero desde el módulo de Liquidaciones."
    );
  }
  if (detail === "project-not-external") {
    return (
      "Esta liquidación es de un proyecto propio, no requiere transferencia " +
      "a un cliente externo."
    );
  }
  if (detail === "no-pending-balance") {
    return (
      "No hay saldo pendiente de transferir para esta liquidación. " +
      "El saldo ya está en cero."
    );
  }
  if (detail === "bank-not-found") {
    return (
      "El banco elegido ya no existe. Recargá la lista y volvé a intentar."
    );
  }
  if (detail === "bank-org-mismatch") {
    return "El banco elegido no pertenece a la misma organización.";
  }

  return message;
}
