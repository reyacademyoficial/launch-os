/**
 * Traductor de errores Postgres para products.
 *
 * CHECKs/uniques del schema 0038:
 *   - unique (project_id, name)
 *   - sales.product_id FK con ON DELETE RESTRICT → 23503 al borrar producto
 *     con ventas asociadas.
 */

export interface ProductErrorLike {
  readonly code?: string | null;
  readonly message?: string | null;
  readonly details?: string | null;
}

export function translateProductError(error: ProductErrorLike): string {
  const code = error.code ?? "";
  const message = error.message ?? "Error desconocido al guardar el producto.";

  if (code === "23505") {
    return "Ya existe un producto con ese nombre en el proyecto.";
  }
  if (code === "23503") {
    if (message.includes("sales")) {
      return (
        "El producto tiene ventas asociadas y no se puede borrar. " +
        "Desactivalo en vez de borrarlo para preservar el histórico."
      );
    }
    return `Referencia inválida: ${error.details || message}`;
  }
  return message;
}
