/**
 * Motor de split de Kingrow — función pura, sin acceso a DB, sin server-only.
 *
 * REGLA DE ORO: `collectedTotal` es un INPUT. Esta función NUNCA lo
 * recalcula ni lo pone en duda. La única fuente de verdad de "cuánto se
 * cobró" es `payments`; el caller debe leerla y pasarla acá.
 *
 * ARITMÉTICA:
 *   base            = collectedTotal (applies_on='collected')
 *                   | totalSold      (applies_on='sold')
 *   percentPart     = (percent_of_collected / 100) × base
 *   fixedLaunch     = fixed_fee_per_launch
 *   fixedSale       = fixed_fee_per_sale × salesCount
 *   rawRetention    = percentPart + fixedLaunch + fixedSale
 *   afterGuarantee  = max(rawRetention, min_guarantee)   si min_guarantee != null
 *                   | rawRetention                       si null
 *   kingrowRetained = min(afterGuarantee, collectedTotal)  ← nunca > cobrado
 *   owedToClient    = collectedTotal − kingrowRetained     (≥ 0 por construcción)
 *
 * Casos que este calc cubre por construcción:
 *   - Propia (%=100, resto 0)              → retained=collected, owed=0
 *   - Externa (%=30)                       → retained=30% × collected
 *   - min_guarantee > %×collected          → retained=min_guarantee (piso)
 *   - min_guarantee > collected            → retained=collected (cap duro)
 *   - collected=0                          → retained=0, owed=0 (nada que repartir)
 *
 * Invariantes que enforza:
 *   - kingrowRetained + owedToClient === collectedTotal  (no se pierde plata)
 *   - kingrowRetained ≤ collectedTotal                    (nunca se retiene más)
 *   - owedToClient ≥ 0                                     (no hay deuda "negativa")
 */

import type {
  SettlementRuleSnapshot,
  SettlementAppliesOn,
} from "./types";

export interface SettlementInputs {
  /** Σ payments.amount de las sales del launch. Leído desde DB, NO recalculado. */
  collectedTotal: number;
  /** Σ sales.total_amount del launch. Solo usado si applies_on='sold'. */
  totalSold: number;
  /** Cantidad de sales del launch. Usado por fixed_fee_per_sale. */
  salesCount: number;
}

export interface SettlementBreakdown {
  base: number;
  percentPart: number;
  fixedLaunchPart: number;
  fixedSalePart: number;
  rawRetention: number;
  retainedAfterGuarantee: number;
  kingrowRetained: number;
  owedToClient: number;
}

function baseFor(
  appliesOn: SettlementAppliesOn,
  inputs: SettlementInputs,
): number {
  return appliesOn === "collected" ? inputs.collectedTotal : inputs.totalSold;
}

export function computeSettlement(
  rule: SettlementRuleSnapshot,
  inputs: SettlementInputs,
): SettlementBreakdown {
  const base = baseFor(rule.applies_on, inputs);

  const percentPart = (rule.percent_of_collected / 100) * base;
  const fixedLaunchPart = rule.fixed_fee_per_launch;
  const fixedSalePart = rule.fixed_fee_per_sale * inputs.salesCount;

  const rawRetention = percentPart + fixedLaunchPart + fixedSalePart;

  const retainedAfterGuarantee =
    rule.min_guarantee != null
      ? Math.max(rawRetention, rule.min_guarantee)
      : rawRetention;

  // Cap duro: aunque la regla diga más (fixed + guarantee etc.), nunca
  // podemos retener más de lo que efectivamente entró.
  const kingrowRetained = Math.min(
    retainedAfterGuarantee,
    inputs.collectedTotal,
  );

  const owedToClient = inputs.collectedTotal - kingrowRetained;

  return {
    base,
    percentPart,
    fixedLaunchPart,
    fixedSalePart,
    rawRetention,
    retainedAfterGuarantee,
    kingrowRetained,
    owedToClient,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Neto de transferencia (post 0170)
// ═══════════════════════════════════════════════════════════════════════════
//
// WHY: `computeSettlement` retiene sobre el TOTAL cobrado — es la parte
// contable ("cuánto le corresponde al cliente"). Pero operativamente lo que
// importa es: de lo que YO tengo en mis bancos (`collectedByMe`), cuánto
// tengo que transferirle al cliente después de descontar mi retención. Si
// el cliente cobró la mayor parte por su banco externo, puede que YO ya
// tenga menos de lo que me corresponde retener — en ese caso él me debe
// transferir la diferencia.
//
//   net_transfer = collectedByMe − kingrowRetained
//     · > 0 → 'kingrow_to_client'
//     · < 0 → 'client_to_kingrow' (monto = |net|)
//     · = 0 → 'none'
//
// El `owedToClient` clásico NO se toca — sigue siendo la línea contable.

export interface SettlementNetTransfer {
  direction: "kingrow_to_client" | "client_to_kingrow" | "none";
  amount: number;
}

export function computeSettlementNetTransfer(
  breakdown: SettlementBreakdown,
  collectedByMe: number,
): SettlementNetTransfer {
  const net = collectedByMe - breakdown.kingrowRetained;
  if (net > 0) {
    return { direction: "kingrow_to_client", amount: net };
  }
  if (net < 0) {
    return { direction: "client_to_kingrow", amount: -net };
  }
  return { direction: "none", amount: 0 };
}
