import type {
  CommissionRuleRow,
  CommissionRuleTierRow,
  PaymentRow,
  SaleRow,
} from "./types";

/**
 * Búsqueda de la regla aplicable a una venta. Prioridad:
 *   1. Rule específica del launch de la venta (override).
 *   2. Rule default del proyecto para esa modalidad (launch_id NULL).
 *   3. null → no hay regla configurada.
 *
 * El match por modalidad ahora va contra `rule.modality_ids` (M:N).
 */
export function findApplicableRule(
  rules: ReadonlyArray<CommissionRuleRow>,
  paymentModalityId: string,
  launchId: string | null,
): CommissionRuleRow | null {
  const candidatesForModality = rules.filter((r) =>
    r.modality_ids.includes(paymentModalityId),
  );

  if (launchId) {
    const launchOverride = candidatesForModality.find(
      (r) => r.launch_id === launchId,
    );
    if (launchOverride) return launchOverride;
  }

  return candidatesForModality.find((r) => r.launch_id === null) ?? null;
}

/**
 * Tier que matchea para una venta en su posición de rank dentro del launch.
 * `saleRank` es 0-based: 0 = 1ra venta del miembro en el launch, 1 = 2da, etc.
 * Recorre tiers ordenados por min_count asc (ya viene así de list.ts).
 */
export function findTierForRank(
  tiers: ReadonlyArray<CommissionRuleTierRow>,
  saleRank: number,
): CommissionRuleTierRow | null {
  for (const t of tiers) {
    const inMin = saleRank >= t.min_count;
    const inMax = t.max_count === null || saleRank <= t.max_count;
    if (inMin && inMax) return t;
  }
  return null;
}

export interface CommissionBreakdown {
  /** Suma de payments.amount. Base autoritativa del cálculo proporcional. */
  collected: number;
  /** sale.total_amount (referencia / pactado). Base del threshold_full. */
  pledged: number;
  /** Cantidad de payments cargados (para threshold por count). */
  paymentCount: number;
  /** Regla aplicada o null si no hay configurada. */
  rule: CommissionRuleRow | null;
  /** Tier elegido según rank de la venta dentro del launch. */
  tier: CommissionRuleTierRow | null;
  /** ¿Cruzó el threshold? true si accrual_mode='proportional'. */
  released: boolean;
  /** Comisión actual en la moneda del negocio. 0 si no hay regla, tier o release. */
  commission: number;
  /** Para mostrar en UI. */
  formula: string;
}

/**
 * Cálculo de comisión — derivado en cada lectura, función pura.
 *
 * Inputs:
 *   - sale, payments: estado de la venta.
 *   - rule: regla aplicable (ya resuelta vía findApplicableRule).
 *   - saleRank: posición 0-based de la venta dentro del (member, launch),
 *     ordenada por closed_at asc, para elegir el tier marginal.
 *
 * Reglas por modo:
 *   - proportional → released siempre true, base = collected
 *   - threshold_full → released si se cruza el umbral, base = pledged
 *   - threshold_proportional → released si umbral, base = collected
 *
 * Tier:
 *   - percent → base × value / 100
 *   - fixed:
 *     · proportional → value × (collected/pledged), capeado a value. Si
 *       pledged = 0, 0 (evita ÷0).
 *     · threshold_full → value entero al cruzar el umbral.
 *     · threshold_proportional → value × (collected/pledged), capeado.
 */
export function computeCommission(
  sale: Pick<SaleRow, "total_amount">,
  payments: ReadonlyArray<Pick<PaymentRow, "amount">>,
  rule: CommissionRuleRow | null,
  saleRank: number,
): CommissionBreakdown {
  const collected = payments.reduce((acc, p) => acc + p.amount, 0);
  const pledged = sale.total_amount;
  const paymentCount = payments.length;

  if (!rule) {
    return {
      collected,
      pledged,
      paymentCount,
      rule: null,
      tier: null,
      released: false,
      commission: 0,
      formula: "Configurar regla",
    };
  }

  const tier = findTierForRank(rule.tiers, saleRank);
  if (!tier) {
    return {
      collected,
      pledged,
      paymentCount,
      rule,
      tier: null,
      released: false,
      commission: 0,
      formula: `Sin tier para venta #${saleRank + 1}`,
    };
  }

  const released = isReleased(rule, collected, pledged, paymentCount);
  if (!released) {
    return {
      collected,
      pledged,
      paymentCount,
      rule,
      tier,
      released: false,
      commission: 0,
      formula: thresholdLabel(rule, false),
    };
  }

  const commission = applyTier(tier, rule.accrual_mode, collected, pledged);
  return {
    collected,
    pledged,
    paymentCount,
    rule,
    tier,
    released: true,
    commission: round2(commission),
    formula: tierLabel(tier, rule),
  };
}

function isReleased(
  rule: CommissionRuleRow,
  collected: number,
  pledged: number,
  paymentCount: number,
): boolean {
  if (rule.accrual_mode === "proportional") return true;
  if (rule.threshold_type === null || rule.threshold_value === null) {
    // Defensa: el constraint SQL impide este caso, pero por si acaso.
    return false;
  }
  if (rule.threshold_type === "payment_count") {
    return paymentCount >= rule.threshold_value;
  }
  // paid_ratio
  if (pledged <= 0) return false;
  return collected / pledged >= rule.threshold_value;
}

function applyTier(
  tier: CommissionRuleTierRow,
  mode: CommissionRuleRow["accrual_mode"],
  collected: number,
  pledged: number,
): number {
  const isFull = mode === "threshold_full";
  if (tier.type === "percent") {
    const base = isFull ? pledged : collected;
    return (base * tier.value) / 100;
  }
  // fixed
  if (isFull) return tier.value;
  // proportional o threshold_proportional → escala el fixed por cobrado/pactado.
  if (pledged <= 0) return 0;
  const ratio = Math.min(collected / pledged, 1);
  return tier.value * ratio;
}

function tierLabel(
  tier: CommissionRuleTierRow,
  rule: CommissionRuleRow,
): string {
  const baseLabel =
    tier.type === "percent"
      ? `${tier.value}%`
      : `$${tier.value}`;
  if (rule.accrual_mode === "threshold_full") {
    return `${baseLabel} sobre el total`;
  }
  if (rule.accrual_mode === "threshold_proportional") {
    return `${baseLabel} (proporcional, post-umbral)`;
  }
  // proportional
  return tier.type === "percent" ? `${baseLabel} del cobrado` : `${baseLabel} proporcional`;
}

function thresholdLabel(rule: CommissionRuleRow, _released: boolean): string {
  if (rule.threshold_type === "payment_count") {
    return `Esperando ${rule.threshold_value} cobros para liberar`;
  }
  if (rule.threshold_type === "paid_ratio") {
    const pct = Math.round((rule.threshold_value ?? 0) * 100);
    return `Esperando ${pct}% cobrado para liberar`;
  }
  return "Esperando umbral";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
