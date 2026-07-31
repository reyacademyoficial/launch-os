/**
 * Traductor de errores Postgres para team_members.
 *
 * No hay constraints propios llamativos hoy en el schema (0013). El único
 * caso frecuente sería una FK cuando se intente borrar un miembro con
 * ventas o payouts asociados — depende de la FK real (ON DELETE …).
 */

export interface TeamMemberErrorLike {
  readonly code?: string | null;
  readonly message?: string | null;
  readonly details?: string | null;
}

export function translateTeamMemberError(
  error: TeamMemberErrorLike,
): string {
  const code = error.code ?? "";
  const message = error.message ?? "Error desconocido al guardar el miembro.";

  if (code === "23503") {
    if (message.includes("sales")) {
      return (
        "El miembro tiene ventas asociadas y no se puede borrar. " +
        "Desactivalo en vez de borrarlo para preservar el histórico."
      );
    }
    if (message.includes("payouts")) {
      return (
        "El miembro tiene payouts registrados y no se puede borrar. " +
        "Desactivalo en vez de borrarlo."
      );
    }
    return `Referencia inválida: ${error.details || message}`;
  }

  if (code === "23505") {
    return "Ya existe un miembro con esos datos.";
  }

  return message;
}
