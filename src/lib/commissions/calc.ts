import type {
  CommissionRuleRow,
  CommissionRuleSnapshot,
  CommissionRuleTierRow,
  PaymentRow,
  SaleRow,
} from "./types";

/**
 * Postgres `numeric` viaja como STRING por PostgREST (evita perder precisión
 * en JS). Nuestros types dicen `number`, pero en runtime llega string. Sin
 * esta coerción, `reduce((acc, p) => acc + p.amount, 0)` concatena strings
 * ("300.00" + "200.00" = "300.00200.00" → NaN), y toda venta con más de un
 * cobro devuelve comisión 0 / NaN — que es el síntoma clásico "no aparecen
 * las comisiones en el leaderboard".
 */
function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  const n = parseFloat(v as string);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Búsqueda de la regla aplicable a una venta. Cascada v2 (Fase 7):
 *   1. Rule específica del producto (product_id=X, launch_id=NULL).
 *   2. Rule específica del launch (launch_id=Y, product_id=NULL).
 *   3. Rule default del proyecto (ambos NULL).
 *   4. null → no hay regla configurada.
 *
 * Producto gana sobre launch — decisión de diseño (opción B): son
 * dimensiones mutuamente excluyentes en el schema (constraint SQL), y en
 * ausencia de una regla exacta preferimos la del producto porque es el
 * "qué se vendió" antes que el "cuándo se vendió".
 *
 * El match por modalidad va contra `rule.modality_ids` (M:N via pivot).
 */
export function findApplicableRule(
  rules: ReadonlyArray<CommissionRuleRow>,
  paymentModalityId: string,
  launchId: string | null,
  productId: string | null = null,
): CommissionRuleRow | null {
  const candidatesForModality = rules.filter((r) =>
    r.modality_ids.includes(paymentModalityId),
  );

  if (productId) {
    const productOverride = candidatesForModality.find(
      (r) => r.product_id === productId && r.launch_id === null,
    );
    if (productOverride) return productOverride;
  }

  if (launchId) {
    const launchOverride = candidatesForModality.find(
      (r) => r.launch_id === launchId && r.product_id === null,
    );
    if (launchOverride) return launchOverride;
  }

  return (
    candidatesForModality.find(
      (r) => r.launch_id === null && r.product_id === null,
    ) ?? null
  );
}

/**
 * Convierte un snapshot congelado a la shape de `CommissionRuleRow` que
 * `computeCommission` sabe consumir. Los campos de identidad (id,
 * project_id, etc.) van con placeholders — al calc no le importan.
 *
 * El snapshot NO tiene launch_id/product_id porque son metadatos de
 * matching, no de cálculo — para eso ya se resolvió la regla al cierre.
 */
function ruleFromSnapshot(snapshot: CommissionRuleSnapshot): CommissionRuleRow {
  const tiers: CommissionRuleTierRow[] = snapshot.tiers.map((t, i) => ({
    id: `snapshot-tier-${i}`,
    rule_id: "snapshot",
    min_count: t.min_count,
    max_count: t.max_count,
    type: t.type,
    value: t.value,
    created_at: "",
    updated_at: "",
  }));
  return {
    id: "snapshot",
    project_id: "",
    launch_id: null,
    product_id: null,
    accrual_mode: snapshot.accrual_mode,
    threshold_type: snapshot.threshold_type,
    threshold_value: snapshot.threshold_value,
    modality_ids: [],
    tiers,
    created_at: "",
    updated_at: "",
  };
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
  sale: Pick<SaleRow, "total_amount" | "commission_rule_snapshot">,
  payments: ReadonlyArray<Pick<PaymentRow, "amount">>,
  rule: CommissionRuleRow | null,
  saleRank: number,
): CommissionBreakdown {
  const collected = payments.reduce((acc, p) => acc + toNum(p.amount), 0);
  const pledged = toNum(sale.total_amount);
  const paymentCount = payments.length;

  // Preferimos el snapshot: es la regla congelada al cierre y es la que
  // define el histórico. Solo caemos a `rule` (findApplicableRule vigente)
  // para ventas legacy sin backfill — la migración 0039 intentó cubrirlas
  // pero puede haber quedado null si no había regla ese día.
  const effectiveRule = sale.commission_rule_snapshot
    ? ruleFromSnapshot(sale.commission_rule_snapshot)
    : rule;

  if (!effectiveRule) {
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

  const tier = findTierForRank(effectiveRule.tiers, saleRank);
  if (!tier) {
    return {
      collected,
      pledged,
      paymentCount,
      rule: effectiveRule,
      tier: null,
      released: false,
      commission: 0,
      formula: `Sin tier para venta #${saleRank + 1}`,
    };
  }

  const released = isReleased(effectiveRule, collected, pledged, paymentCount);
  if (!released) {
    return {
      collected,
      pledged,
      paymentCount,
      rule: effectiveRule,
      tier,
      released: false,
      commission: 0,
      formula: thresholdLabel(effectiveRule, false),
    };
  }

  const commission = applyTier(
    tier,
    effectiveRule.accrual_mode,
    collected,
    pledged,
  );
  return {
    collected,
    pledged,
    paymentCount,
    rule: effectiveRule,
    tier,
    released: true,
    commission: round2(commission),
    formula: tierLabel(tier, effectiveRule),
  };
}

function isReleased(
  rule: CommissionRuleRow,
  collected: number,
  pledged: number,
  paymentCount: number,
): boolean {
  // proportional: se devenga con cada cobro parcial.
  // on_close: se devenga completo al cerrar la venta, sin depender de cobros.
  if (rule.accrual_mode === "proportional") return true;
  if (rule.accrual_mode === "on_close") return true;
  if (rule.threshold_type === null || rule.threshold_value === null) {
    // Defensa: el constraint SQL impide este caso, pero por si acaso.
    return false;
  }
  const threshold = toNum(rule.threshold_value);
  if (rule.threshold_type === "payment_count") {
    return paymentCount >= threshold;
  }
  // paid_ratio
  if (pledged <= 0) return false;
  return collected / pledged >= threshold;
}

function applyTier(
  tier: CommissionRuleTierRow,
  mode: CommissionRuleRow["accrual_mode"],
  collected: number,
  pledged: number,
): number {
  const value = toNum(tier.value);
  // Modos que usan el pactado como base entero — no escalan por cobro.
  const usesPledgedFull = mode === "threshold_full" || mode === "on_close";
  if (tier.type === "percent") {
    const base = usesPledgedFull ? pledged : collected;
    return (base * value) / 100;
  }
  // fixed
  if (usesPledgedFull) return value;
  // proportional o threshold_proportional → escala el fixed por cobrado/pactado.
  if (pledged <= 0) return 0;
  const ratio = Math.min(collected / pledged, 1);
  return value * ratio;
}

function tierLabel(
  tier: CommissionRuleTierRow,
  rule: CommissionRuleRow,
): string {
  const baseLabel =
    tier.type === "percent"
      ? `${tier.value}%`
      : `$${tier.value}`;
  if (rule.accrual_mode === "on_close") {
    return tier.type === "percent"
      ? `${baseLabel} del pactado (al cerrar)`
      : `${baseLabel} fijos por venta cerrada`;
  }
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
