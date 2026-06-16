"use server";

import { revalidatePath } from "next/cache";

import {
  ALERT_METRICS,
  ALERT_OPERATORS,
  type AlertMetric,
  type AlertOperator,
} from "@/lib/alerts/types";
import { requireCanEditLaunchesIn, requireSessionProfile } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export type AlertActionState = { ok: true } | { error: string } | null;

/**
 * Crea una regla de alerta. La RLS de alert_rules_insert ya valida que el
 * caller tenga can_edit_launches_in(project_of_launch). El UNIQUE
 * (launch_id, metric, operator, threshold) bloquea duplicados exactos →
 * surfaceamos como error específico.
 */
export async function createAlertRule(
  projectId: string,
  launchId: string,
  _prev: AlertActionState,
  formData: FormData,
): Promise<AlertActionState> {
  const profile = await requireCanEditLaunchesIn(projectId);

  const metricRaw = String(formData.get("metric") ?? "").trim();
  const operatorRaw = String(formData.get("operator") ?? "").trim();
  const thresholdRaw = String(formData.get("threshold") ?? "").trim();

  if (!(ALERT_METRICS as ReadonlyArray<string>).includes(metricRaw)) {
    return { error: "Métrica inválida." };
  }
  if (!(ALERT_OPERATORS as ReadonlyArray<string>).includes(operatorRaw)) {
    return { error: "Operador inválido." };
  }
  const threshold = Number(thresholdRaw);
  if (!Number.isFinite(threshold) || threshold < 0) {
    return { error: "El umbral debe ser un número >= 0." };
  }

  const supabase = await createClient();
  const payload = {
    launch_id: launchId,
    metric: metricRaw as AlertMetric,
    operator: operatorRaw as AlertOperator,
    threshold,
    active: true,
    created_by: profile.id,
  } as never;
  const { error } = await supabase.from("alert_rules").insert(payload);
  if (error) {
    if (error.code === "23505") {
      return { error: "Ya existe una regla idéntica para este lanzamiento." };
    }
    return { error: error.message };
  }

  revalidatePath(`/proyectos/${projectId}/launches/${launchId}/alertas`);
  return { ok: true };
}

/**
 * Toggle active. UPDATE column-specific, scoped al launch para que URL
 * tampering con un id de otro launch no cuele (la RLS además filtra).
 */
export async function toggleAlertRule(
  projectId: string,
  launchId: string,
  ruleId: string,
  nextActive: boolean,
): Promise<void> {
  await requireCanEditLaunchesIn(projectId);
  const supabase = await createClient();
  await supabase
    .from("alert_rules")
    .update({ active: nextActive } as never)
    .eq("id", ruleId)
    .eq("launch_id", launchId);
  revalidatePath(`/proyectos/${projectId}/launches/${launchId}/alertas`);
}

export async function deleteAlertRule(
  projectId: string,
  launchId: string,
  ruleId: string,
): Promise<void> {
  await requireSessionProfile();
  await requireCanEditLaunchesIn(projectId);
  const supabase = await createClient();
  await supabase
    .from("alert_rules")
    .delete()
    .eq("id", ruleId)
    .eq("launch_id", launchId);
  revalidatePath(`/proyectos/${projectId}/launches/${launchId}/alertas`);
}
