import { listCommissionRules } from "@/lib/commissions/list";
import type { CommissionRuleRow, CommissionRuleSnapshot } from "@/lib/commissions/types";
import { findApplicableRule } from "@/lib/commissions/calc";

/**
 * Congela una regla en la forma que `sales.commission_rule_snapshot` guarda.
 * El snapshot es minimalista — sólo lo que necesita `computeCommission`:
 * accrual, threshold, y la lista de tiers ordenada por min_count.
 */
export function ruleToSnapshot(rule: CommissionRuleRow): CommissionRuleSnapshot {
  return {
    accrual_mode: rule.accrual_mode,
    threshold_type: rule.threshold_type,
    threshold_value: rule.threshold_value,
    tiers: [...rule.tiers]
      .sort((a, b) => a.min_count - b.min_count)
      .map((t) => ({
        min_count: t.min_count,
        max_count: t.max_count,
        type: t.type,
        value: t.value,
        currency: t.currency,
      })),
  };
}

/**
 * Busca la regla vigente para (modality, launch, product) y devuelve el
 * snapshot listo para persistir. Devuelve null si NO hay ninguna regla que
 * matchee — el caller debe interpretarlo como error (Fase 7: comisiones
 * obligatorias por cada combinación).
 */
export async function resolveSnapshotForSale(
  projectId: string,
  paymentModalityId: string,
  launchId: string | null,
  productId: string,
): Promise<CommissionRuleSnapshot | null> {
  const rules = await listCommissionRules(projectId);
  const rule = findApplicableRule(rules, paymentModalityId, launchId, productId);
  return rule ? ruleToSnapshot(rule) : null;
}
