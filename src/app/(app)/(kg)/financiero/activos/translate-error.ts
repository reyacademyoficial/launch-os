/**
 * Traductor de errores de Postgres al vocabulario de la UI de activos.
 *
 * CHECKs del schema 0067:
 *   - amount >= 0
 *   - original_cost is null OR original_cost >= 0
 *   - depreciation >= 0
 *   - asset_type IN (9 valores fijos)
 */

export interface AssetErrorLike {
  readonly code?: string | null;
  readonly message?: string | null;
  readonly details?: string | null;
}

export function translateAssetError(error: AssetErrorLike): string {
  const code = error.code ?? "";
  const message = error.message ?? "Error desconocido al guardar el activo.";

  if (code === "23514") {
    if (message.includes("asset_type")) {
      return "El tipo de activo elegido no es válido.";
    }
    // Cualquier CHECK numérico (amount, original_cost, depreciation).
    return "El activo no cumple una restricción de validez. Revisá los montos.";
  }

  if (code === "23503") {
    return `Referencia inválida: ${error.details || message}`;
  }

  return message;
}
