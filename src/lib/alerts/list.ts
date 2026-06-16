import "server-only";

import { createClient } from "@/lib/supabase/server";

import type { AlertRuleRow } from "./types";

export async function listAlertRulesForLaunch(
  launchId: string,
): Promise<AlertRuleRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("alert_rules")
    .select(
      "id, launch_id, metric, operator, threshold, active, created_by, created_at, updated_at",
    )
    .eq("launch_id", launchId)
    .order("metric", { ascending: true })
    .order("threshold", { ascending: true });

  return (data ?? []) as unknown as AlertRuleRow[];
}
