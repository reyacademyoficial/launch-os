import "server-only";

import { createClient } from "@/lib/supabase/server";

import type {
  AccrualMode,
  CommissionRuleRow,
  CommissionRuleTierRow,
  CommissionTierType,
  PaymentModalityRow,
  ThresholdType,
} from "./types";

export async function listPaymentModalities(
  projectId: string,
): Promise<PaymentModalityRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("payment_modalities")
    .select("*")
    .eq("project_id", projectId)
    .order("active", { ascending: false })
    .order("name", { ascending: true });

  return (data ?? []) as unknown as PaymentModalityRow[];
}

/**
 * Hidrata cada regla del proyecto con sus `tiers` (ordenados por min_count)
 * y `modality_ids` (del pivot). El consumidor (UI, leaderboard) trabaja con
 * el shape "rico" — la división en 3 tablas es detalle de persistencia.
 */
export async function listCommissionRules(
  projectId: string,
): Promise<CommissionRuleRow[]> {
  const supabase = await createClient();

  // Reglas base.
  const { data: rulesRaw } = await supabase
    .from("commission_rules")
    .select("id, project_id, launch_id, product_id, accrual_mode, threshold_type, threshold_value, created_at, updated_at")
    .eq("project_id", projectId)
    .order("launch_id", { ascending: true, nullsFirst: true });

  const rules = (rulesRaw ?? []) as unknown as Array<{
    id: string;
    project_id: string;
    launch_id: string | null;
    product_id: string | null;
    accrual_mode: AccrualMode;
    threshold_type: ThresholdType | null;
    threshold_value: number | null;
    created_at: string;
    updated_at: string;
  }>;

  if (rules.length === 0) return [];

  const ruleIds = rules.map((r) => r.id);

  const [tiersRes, pivotRes] = await Promise.all([
    supabase
      .from("commission_rule_tiers")
      .select("*")
      .in("rule_id", ruleIds)
      .order("min_count", { ascending: true }),
    supabase
      .from("commission_rule_modalities")
      .select("rule_id, payment_modality_id")
      .in("rule_id", ruleIds),
  ]);

  const tiers = (tiersRes.data ?? []) as unknown as CommissionRuleTierRow[];
  const pivot = (pivotRes.data ?? []) as unknown as Array<{
    rule_id: string;
    payment_modality_id: string;
  }>;

  const tiersByRule = new Map<string, CommissionRuleTierRow[]>();
  for (const t of tiers) {
    const arr = tiersByRule.get(t.rule_id);
    if (arr) arr.push(t);
    else tiersByRule.set(t.rule_id, [t]);
  }

  const modalitiesByRule = new Map<string, string[]>();
  for (const p of pivot) {
    const arr = modalitiesByRule.get(p.rule_id);
    if (arr) arr.push(p.payment_modality_id);
    else modalitiesByRule.set(p.rule_id, [p.payment_modality_id]);
  }

  return rules.map((r) => ({
    ...r,
    tiers: tiersByRule.get(r.id) ?? [],
    modality_ids: modalitiesByRule.get(r.id) ?? [],
  }));
}

export type { CommissionTierType };
