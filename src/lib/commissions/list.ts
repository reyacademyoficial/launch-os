import "server-only";

import { createClient } from "@/lib/supabase/server";

import type { CommissionRuleRow, PaymentModalityRow } from "./types";

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

export async function listCommissionRules(
  projectId: string,
): Promise<CommissionRuleRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("commission_rules")
    .select("*")
    .eq("project_id", projectId)
    .order("payment_modality_id", { ascending: true })
    .order("launch_id", { ascending: true, nullsFirst: true });

  return (data ?? []) as unknown as CommissionRuleRow[];
}
