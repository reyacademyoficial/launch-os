/**
 * Tipos de `liabilities`. Espeja el CHECK del schema (0068).
 *
 * Los 5 valores cubren el 90% de los pasivos de una operación como Kingrow:
 *   - prestamo      → préstamo bancario, cheque de terceros, etc.
 *   - credito       → tarjetas y líneas revolventes
 *   - deuda_fiscal  → AFIP, IIBB, retenciones no depositadas
 *   - provision     → devengado sin factura (aguinaldo, vacaciones, juicios)
 *   - otro          → catch-all
 */

export const LIABILITY_TYPES = [
  "prestamo",
  "credito",
  "deuda_fiscal",
  "provision",
  "otro",
] as const;

export type LiabilityType = (typeof LIABILITY_TYPES)[number];

export const LIABILITY_TYPE_LABELS: Record<LiabilityType, string> = {
  prestamo: "Préstamo",
  credito: "Crédito",
  deuda_fiscal: "Deuda fiscal",
  provision: "Provisión",
  otro: "Otro",
};

export function isValidLiabilityType(value: unknown): value is LiabilityType {
  return (
    typeof value === "string" &&
    (LIABILITY_TYPES as readonly string[]).includes(value)
  );
}
