/**
 * Traductores de errores de Postgres (postgrest-js) a mensajes de UI para
 * el módulo de liquidaciones. Puras, sin efectos — testeables.
 *
 * Vive fuera de `actions.ts` porque ese archivo lleva `"use server"` y el
 * régimen server-actions solo permite exportar async. Además, mantener la
 * traducción explícita como contrato: si mañana la RPC o el orquestador
 * empiezan a devolver un `reason`/`detail` nuevo, este archivo es el único
 * que hay que tocar (y los tests fallan si un caso deja de manejarse).
 */

import type { CreateSettlementFailReason } from "@/lib/settlements/create";

// ═══════════════════════════════════════════════════════════════════════════
// createSettlement — traduce los `reason` del orquestador (create.ts)
// ═══════════════════════════════════════════════════════════════════════════

export function translateCreateSettlementError(
  reason: CreateSettlementFailReason,
): string {
  switch (reason) {
    case "launch-not-found":
      return "No se encontró el lanzamiento indicado.";
    case "no-rule":
      return (
        "Este lanzamiento (o su proyecto) no tiene una regla de split activa. " +
        "Configurala primero en Reglas de split."
      );
    case "no-payments":
      return (
        "Este lanzamiento todavía no tiene pagos registrados. " +
        "No hay nada que liquidar."
      );
    case "already-settled":
      return (
        "Este lanzamiento ya tiene una liquidación cerrada. Las liquidaciones " +
        "complementarias por pagos posteriores todavía no están implementadas " +
        "— cuando entren pagos nuevos de este lanzamiento, van a quedar sin " +
        "liquidar hasta que exista esa función."
      );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// closeLaunchSettlement — traduce errores de la RPC 0100
// ═══════════════════════════════════════════════════════════════════════════

export interface CloseSettlementErrorLike {
  readonly code?: string | null;
  readonly message?: string | null;
  readonly details?: string | null;
}

/**
 * La RPC 0100 devuelve códigos SQLSTATE con un `detail` distinguible en el
 * campo `details` (postgrest-js lo expone así). Priorizamos el `detail` sobre
 * el message porque el message viene en castellano ya, pero el detail nos
 * deja saber cuál guard falló específicamente y proponer una acción.
 */
export function translateCloseSettlementError(
  error: CloseSettlementErrorLike,
): string {
  const detail = (error.details ?? "").trim();
  const message =
    error.message ?? "Error desconocido al cerrar la liquidación.";

  // Marcadores emitidos por la RPC con `raise ... using detail = ...`.
  // El código SQLSTATE (23514 / P0002) es informativo — matcheamos por detail
  // porque es lo que la RPC realmente controla.
  if (detail === "closed-at-required") {
    return "Elegí una fecha de cierre para la liquidación.";
  }
  if (detail === "settlement-not-open") {
    return (
      "Esta liquidación no está abierta. Solo se pueden cerrar las que están " +
      "en borrador."
    );
  }
  if (detail === "settlement-not-found") {
    return (
      "La liquidación ya no existe. Alguien puede haberla eliminado — " +
      "recargá y volvé a intentar."
    );
  }

  // Fallback: si aparece un código nuevo o un error de infra, propagamos el
  // texto original en vez de tragarlo. Mejor mensaje técnico que silencio.
  return message;
}
