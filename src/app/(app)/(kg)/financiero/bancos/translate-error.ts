/**
 * Traductor de errores Postgres para banks. Cubre principalmente el UNIQUE
 * (organization_id, name) — 23505 — y FK — 23503.
 *
 * El caso más común es el intento de crear un banco con el mismo nombre que
 * uno existente. Post 0101 el unique es org-scope, así que el mensaje refiere
 * a "esta organización".
 */

export interface BankErrorLike {
  readonly code?: string | null;
  readonly message?: string | null;
  readonly details?: string | null;
}

export function translateBankError(error: BankErrorLike): string {
  const code = error.code ?? "";
  const message = error.message ?? "Error desconocido al guardar el banco.";

  if (code === "23505") {
    if (message.includes("organization_id")) {
      return "Ya existe un banco con ese nombre en la organización.";
    }
    return "Ya existe un banco con esos datos.";
  }

  if (code === "23503") {
    return `Referencia inválida: ${error.details || message}`;
  }

  if (code === "23514") {
    if (message.includes("banks_external_collector_coherence")) {
      return "Configuración incoherente: cobro externo requiere proyecto.";
    }
    // opening_balance no tiene CHECK explícito hoy, pero por si aparece.
    return "El banco no cumple una restricción de validez.";
  }

  return message;
}
