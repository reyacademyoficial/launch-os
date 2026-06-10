"use server";

import { revalidatePath } from "next/cache";

import { requireCanEditProject } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import type { CommissionRuleType } from "@/lib/commissions/types";

export type CommissionActionState = { ok: true } | { error: string } | null;

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function nullable(value: string): string | null {
  return value === "" ? null : value;
}

// ─── payment_modalities ───────────────────────────────────────────────────

export async function createPaymentModality(
  projectId: string,
  _prev: CommissionActionState,
  formData: FormData,
): Promise<CommissionActionState> {
  await requireCanEditProject(projectId);
  const name = str(formData, "name");
  if (!name) return { error: "El nombre es obligatorio." };

  const supabase = await createClient();
  const payload = { project_id: projectId, name, active: true } as never;
  const { error } = await supabase.from("payment_modalities").insert(payload);
  if (error) return { error: error.message };

  revalidatePath(`/proyectos/${projectId}/comisiones`);
  return { ok: true };
}

export async function updatePaymentModality(
  projectId: string,
  modalityId: string,
  _prev: CommissionActionState,
  formData: FormData,
): Promise<CommissionActionState> {
  await requireCanEditProject(projectId);
  const name = str(formData, "name");
  if (!name) return { error: "El nombre es obligatorio." };
  const active = formData.get("active") !== null;

  const supabase = await createClient();
  const payload = { name, active } as never;
  const { error } = await supabase
    .from("payment_modalities")
    .update(payload)
    .eq("id", modalityId)
    .eq("project_id", projectId);
  if (error) return { error: error.message };

  revalidatePath(`/proyectos/${projectId}/comisiones`);
  return { ok: true };
}

export async function deletePaymentModality(
  projectId: string,
  modalityId: string,
): Promise<void> {
  await requireCanEditProject(projectId);
  const supabase = await createClient();
  await supabase
    .from("payment_modalities")
    .delete()
    .eq("id", modalityId)
    .eq("project_id", projectId);
  revalidatePath(`/proyectos/${projectId}/comisiones`);
}

// ─── commission_rules ─────────────────────────────────────────────────────

export async function createCommissionRule(
  projectId: string,
  _prev: CommissionActionState,
  formData: FormData,
): Promise<CommissionActionState> {
  await requireCanEditProject(projectId);

  const payment_modality_id = str(formData, "payment_modality_id");
  if (!payment_modality_id) return { error: "Elegí una modalidad." };

  const launch_id = nullable(str(formData, "launch_id"));

  const typeRaw = str(formData, "type");
  if (typeRaw !== "percent" && typeRaw !== "fixed") {
    return { error: "Tipo inválido." };
  }

  const valueRaw = str(formData, "value");
  const value = parseFloat(valueRaw);
  if (!Number.isFinite(value) || value < 0) {
    return { error: "Valor inválido." };
  }

  const supabase = await createClient();
  const payload = {
    project_id: projectId,
    payment_modality_id,
    launch_id,
    type: typeRaw as CommissionRuleType,
    value,
  } as never;
  const { error } = await supabase.from("commission_rules").insert(payload);
  if (error) {
    if (error.code === "23505") {
      return { error: "Ya existe una regla para esa modalidad/launch." };
    }
    return { error: error.message };
  }

  revalidatePath(`/proyectos/${projectId}/comisiones`);
  return { ok: true };
}

export async function deleteCommissionRule(
  projectId: string,
  ruleId: string,
): Promise<void> {
  await requireCanEditProject(projectId);
  const supabase = await createClient();
  await supabase
    .from("commission_rules")
    .delete()
    .eq("id", ruleId)
    .eq("project_id", projectId);
  revalidatePath(`/proyectos/${projectId}/comisiones`);
}
