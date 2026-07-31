/**
 * Traductor de errores Postgres para payment_modalities y commission_rules.
 *
 * El caso frecuente es el 23505 que emite el trigger del pivot rule×modality
 * cuando se intenta crear una regla que colisiona con otra ya activa para
 * el mismo (project, launch, product, modality).
 */

export interface CommissionErrorLike {
  readonly code?: string | null;
  readonly message?: string | null;
  readonly details?: string | null;
}

export function translateCommissionError(error: CommissionErrorLike): string {
  const code = error.code ?? "";
  const message = error.message ?? "Error desconocido al guardar.";

  if (code === "23505") {
    // El pivot commission_rule_modalities tiene un unique parcial que
    // dispara este error cuando dos reglas cubrirían la misma modalidad
    // para el mismo scope (launch o producto).
    return (
      "Una de las modalidades elegidas ya tiene una regla para ese scope " +
      "(launch o producto). Editá la regla existente en vez de crear otra."
    );
  }

  if (code === "23503") {
    return `Referencia inválida: ${error.details || message}`;
  }

  return message;
}
