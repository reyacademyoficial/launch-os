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

import type {
  CreateComplementarySettlementFailReason,
  CreateSettlementFailReason,
} from "@/lib/settlements/create";
import type { ReopenSettlementFailReason } from "@/lib/settlements/reopen";

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
        "Este lanzamiento ya tiene una liquidación cerrada. Si hay pagos " +
        "posteriores sin liquidar, usá la opción de liquidación " +
        "complementaria en vez de crear una nueva."
      );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// createComplementarySettlement — traduce reasons del orquestador (create.ts)
// ═══════════════════════════════════════════════════════════════════════════

export function translateComplementarySettlementError(
  reason: CreateComplementarySettlementFailReason,
): string {
  switch (reason) {
    case "launch-not-found":
      return "No se encontró el lanzamiento indicado.";
    case "no-rule":
      return (
        "Este lanzamiento (o su proyecto) no tiene una regla de split activa. " +
        "Configurala primero en Reglas de split."
      );
    case "no-closed-settlement":
      return (
        "No hay ninguna liquidación cerrada para este lanzamiento. Usá " +
        "'Crear liquidación' en lugar de complementaria."
      );
    case "no-new-payments":
      return (
        "No entraron pagos nuevos desde la última liquidación. No hay " +
        "nada nuevo para complementar."
      );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// reopenLaunchSettlement — traduce reasons del RPC 0130
// ═══════════════════════════════════════════════════════════════════════════

export function translateReopenSettlementError(
  reason: ReopenSettlementFailReason,
): string {
  switch (reason) {
    case "reopen-reason-required":
      return "Escribí un motivo para reabrir la liquidación.";
    case "settlement-not-found":
      return (
        "La liquidación ya no existe. Alguien puede haberla eliminado — " +
        "recargá y volvé a intentar."
      );
    case "settlement-not-liquidada":
      return (
        "Solo se pueden reabrir liquidaciones en estado 'liquidada'. Los " +
        "borradores no hace falta reabrirlos; las transferidas ya movieron " +
        "plata y requieren un ajuste manual."
      );
    case "settlement-has-bank-movements":
      return (
        "Esta liquidación tiene movimientos bancarios linkeados. Desvinculá " +
        "las transferencias asociadas antes de reabrir."
      );
    case "unknown":
      return "Error desconocido al reabrir la liquidación.";
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
