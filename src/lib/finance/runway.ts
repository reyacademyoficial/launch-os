/**
 * Runway classifier — política de UI, NO selector.
 *
 * `computeRunway` (en `kpis.ts`) es el selector puro que devuelve `number`
 * (meses), `null` (burn ≤ 0) o `0` (caja ≤ 0). Esa firma se respeta y no se
 * toca — es contrato del bloque económico.
 *
 * Este módulo la envuelve con la política:
 *   - Si la caja no se pudo consolidar (banks ARS sin tasa FX cargada) →
 *     runway "—" con reason `no-cash-data`.
 *   - Si el snapshot de caja está viejo → runway "—" con hint específico
 *     (relevante cuando `cashOnHand` viene de assets manuales; con caja
 *     derivada de bank_movements no aplica y el caller pasa `false`).
 *   - Si el burn es 0 por falta de datos → runway "—" con hint específico
 *     (el "∞" ya no se usa: burn=0 significa "no tenemos gastos cargados",
 *     no significa "Kingrow no gasta").
 *   - En cualquier otro caso → número de meses (puede ser 0 si la caja está
 *     agotada; se muestra "0 meses").
 *
 * La distinción viaja via `reason` — el componente lo lee para elegir el hint
 * y el tono. Nunca se pinta el número.
 */

import { computeRunway } from "./kpis";

export type RunwayReason =
  | "ok"
  | "stale-snapshot"
  | "no-burn-data"
  | "no-cash-data";

export interface RunwayClassification {
  /** `null` significa "mostrar em-dash". Nunca es undefined. */
  readonly months: number | null;
  readonly reason: RunwayReason;
}

export interface ClassifyRunwayInputs {
  /** `null` = caja no consolidable (falta tasa FX para bancos ARS). */
  readonly cashOnHand: number | null;
  readonly monthlyBurn: number;
  readonly snapshotStale: boolean;
}

export function classifyRunway(
  inputs: ClassifyRunwayInputs,
): RunwayClassification {
  // Precedencia 1: caja no consolidada. Sin numerador confiable no hay
  // runway posible; hint específico para que el operador cargue la tasa.
  if (inputs.cashOnHand == null) {
    return { months: null, reason: "no-cash-data" };
  }
  // Precedencia 2: si la caja está desactualizada, no importa el burn — no
  // podemos garantizar el numerador. Mostrar "—" con hint de snapshot.
  if (inputs.snapshotStale) {
    return { months: null, reason: "stale-snapshot" };
  }
  // Burn 0/negativo: ambiguo entre "no hay quema" y "no hay datos". En 6b
  // asumimos siempre "no hay datos" — es lo más útil como advertencia. El día
  // que haya datos limpios y burn = 0 de verdad, se refina.
  if (inputs.monthlyBurn <= 0) {
    return { months: null, reason: "no-burn-data" };
  }
  const months = computeRunway({
    cashOnHand: inputs.cashOnHand,
    monthlyBurn: inputs.monthlyBurn,
  });
  // computeRunway devuelve null solo si burn ≤ 0, ya cubierto arriba. Aquí
  // esperamos number (puede ser 0 si la caja está en 0 o negativa).
  return { months: months ?? 0, reason: "ok" };
}
