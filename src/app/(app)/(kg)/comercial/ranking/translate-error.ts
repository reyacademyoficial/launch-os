/**
 * Traductor de errores Postgres para team_member_payouts.
 *
 * FK principales del schema 0030:
 *   - team_member_id → team_members
 *   - launch_id → launches
 *   - project_id → projects
 *
 * Sin uniques loud hoy; el 23503 aparece si se borra en carrera el
 * team_member o el launch referenciado.
 */

export interface PayoutErrorLike {
  readonly code?: string | null;
  readonly message?: string | null;
  readonly details?: string | null;
}

export function translatePayoutError(error: PayoutErrorLike): string {
  const code = error.code ?? "";
  const message = error.message ?? "Error desconocido al guardar el payout.";

  if (code === "23503") {
    if (message.includes("team_member_id")) {
      return "El miembro elegido ya no existe. Recargá y reintentá.";
    }
    if (message.includes("launch_id")) {
      return "El lanzamiento elegido ya no existe. Recargá y reintentá.";
    }
    return `Referencia inválida: ${error.details || message}`;
  }

  if (code === "23514") {
    return "El payout no cumple una restricción de validez. Revisá el monto.";
  }

  return message;
}
