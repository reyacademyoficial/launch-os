import type {
  CommissionRuleRow,
  PaymentRow,
  SaleRow,
} from "./types";

/**
 * Búsqueda de la regla aplicable a una venta. Prioridad:
 *   1. Rule específica del launch de la venta (override).
 *   2. Rule default del proyecto para esa modalidad (launch_id NULL).
 *   3. null → no hay regla configurada.
 *
 * `launchId` viene del lead asociado a la venta (la venta no guarda launch
 * directo; pasa por leads.launch_id). Si el lead no tiene launch, solo busca
 * la default.
 */
export function findApplicableRule(
  rules: ReadonlyArray<CommissionRuleRow>,
  paymentModalityId: string,
  launchId: string | null,
): CommissionRuleRow | null {
  const sameModality = rules.filter((r) => r.payment_modality_id === paymentModalityId);

  if (launchId) {
    const launchOverride = sameModality.find((r) => r.launch_id === launchId);
    if (launchOverride) return launchOverride;
  }

  return sameModality.find((r) => r.launch_id === null) ?? null;
}

export interface CommissionBreakdown {
  /** Suma de payments.amount. Base autoritativa del cálculo. */
  collected: number;
  /** sale.total_amount (referencia / pactado). */
  pledged: number;
  /** Regla aplicada o null si no hay configurada. */
  rule: CommissionRuleRow | null;
  /** Comisión actual en pesos (o lo que sea la moneda). 0 si no hay regla. */
  commission: number;
  /** Para mostrar en UI: "10%" / "$500 (proporcional)" / "—". */
  formula: string;
}

/**
 * Cálculo de comisión sobre lo COBRADO, no sobre lo pactado.
 *
 *   - type=percent → commission = collected * value / 100
 *   - type=fixed   → proporcional: commission = value * (collected / pledged).
 *     Si pledged = 0, el cobro va a infinito; lo tratamos como 0 (la venta no
 *     tendría sentido si está a 0 de pactado).
 *
 * Si no hay regla aplicable, commission = 0 y el `formula` lo indica.
 * Re-evaluación pura: no hay efectos secundarios; misma entrada, misma salida.
 */
export function computeCommission(
  sale: Pick<SaleRow, "total_amount">,
  payments: ReadonlyArray<Pick<PaymentRow, "amount">>,
  rule: CommissionRuleRow | null,
): CommissionBreakdown {
  const collected = payments.reduce((acc, p) => acc + p.amount, 0);
  const pledged = sale.total_amount;

  if (!rule) {
    return {
      collected,
      pledged,
      rule: null,
      commission: 0,
      formula: "Configurar regla",
    };
  }

  if (rule.type === "percent") {
    return {
      collected,
      pledged,
      rule,
      commission: round2(collected * (rule.value / 100)),
      formula: `${rule.value}% del cobrado`,
    };
  }

  // fixed → proporcional
  if (pledged <= 0) {
    return {
      collected,
      pledged,
      rule,
      commission: 0,
      formula: `$${rule.value} (sin total pactado)`,
    };
  }
  const ratio = collected / pledged;
  return {
    collected,
    pledged,
    rule,
    commission: round2(rule.value * Math.min(ratio, 1)),
    formula: `$${rule.value} proporcional`,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
