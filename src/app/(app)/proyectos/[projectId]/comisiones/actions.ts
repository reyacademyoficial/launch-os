"use server";

import { revalidatePath } from "next/cache";

import { requireCanEditProject } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import type {
  AccrualMode,
  CommissionTierType,
  ThresholdType,
} from "@/lib/commissions/types";

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

interface TierInput {
  min_count: number;
  max_count: number | null;
  type: CommissionTierType;
  value: number;
}

/**
 * Valida los tiers que vienen del form:
 *   - al menos 1
 *   - el 1ro arranca en min_count=0
 *   - sin huecos: cada tier siguiente min_count = prev.max_count + 1
 *   - max_count >= min_count
 *   - el último tier puede tener max_count=null (sin tope)
 *   - value >= 0
 */
function validateTiers(tiers: TierInput[]): string | null {
  if (tiers.length === 0) return "Cargá al menos un tramo.";
  const sorted = [...tiers].sort((a, b) => a.min_count - b.min_count);

  if (sorted[0]!.min_count !== 0) {
    return "El primer tramo tiene que arrancar en venta #1 (min_count = 0).";
  }

  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i]!;
    if (t.value < 0) return "Los valores no pueden ser negativos.";
    if (t.type !== "percent" && t.type !== "fixed") return "Tipo de tramo inválido.";
    if (t.max_count !== null && t.max_count < t.min_count) {
      return `Tramo ${i + 1}: max_count debe ser >= min_count.`;
    }
    const isLast = i === sorted.length - 1;
    if (!isLast && t.max_count === null) {
      return `Solo el último tramo puede tener "sin tope".`;
    }
    if (!isLast) {
      const next = sorted[i + 1]!;
      if (next.min_count !== (t.max_count ?? 0) + 1) {
        return `Hay un hueco entre el tramo ${i + 1} y el ${i + 2}.`;
      }
    }
  }
  return null;
}

function parseTiers(formData: FormData): TierInput[] | string {
  // Esperamos pares tiers[0][min_count], tiers[0][max_count], tiers[0][type], tiers[0][value], etc.
  const tiers: TierInput[] = [];
  let i = 0;
  while (formData.has(`tiers[${i}][type]`)) {
    const minRaw = str(formData, `tiers[${i}][min_count]`);
    const maxRaw = str(formData, `tiers[${i}][max_count]`);
    const typeRaw = str(formData, `tiers[${i}][type]`);
    const valueRaw = str(formData, `tiers[${i}][value]`);

    const min_count = parseInt(minRaw, 10);
    if (!Number.isFinite(min_count) || min_count < 0) {
      return `Tramo ${i + 1}: min_count inválido.`;
    }
    const max_count = maxRaw === "" ? null : parseInt(maxRaw, 10);
    if (max_count !== null && !Number.isFinite(max_count)) {
      return `Tramo ${i + 1}: max_count inválido.`;
    }
    if (typeRaw !== "percent" && typeRaw !== "fixed") {
      return `Tramo ${i + 1}: tipo inválido.`;
    }
    const value = parseFloat(valueRaw);
    if (!Number.isFinite(value) || value < 0) {
      return `Tramo ${i + 1}: valor inválido.`;
    }
    tiers.push({ min_count, max_count, type: typeRaw, value });
    i++;
  }
  return tiers;
}

export async function createCommissionRule(
  projectId: string,
  _prev: CommissionActionState,
  formData: FormData,
): Promise<CommissionActionState> {
  await requireCanEditProject(projectId);

  // Modalidades (múltiple) — esperamos varios values con key "modality_ids".
  const modalityIds = formData.getAll("modality_ids").map(String).filter(Boolean);
  if (modalityIds.length === 0) {
    return { error: "Elegí al menos una modalidad." };
  }

  const launch_id = nullable(str(formData, "launch_id"));

  const accrualRaw = str(formData, "accrual_mode") || "proportional";
  if (
    accrualRaw !== "proportional" &&
    accrualRaw !== "threshold_full" &&
    accrualRaw !== "threshold_proportional"
  ) {
    return { error: "Modo de devengamiento inválido." };
  }
  const accrual_mode = accrualRaw as AccrualMode;

  let threshold_type: ThresholdType | null = null;
  let threshold_value: number | null = null;
  if (accrual_mode !== "proportional") {
    const thRaw = str(formData, "threshold_type");
    if (thRaw !== "payment_count" && thRaw !== "paid_ratio") {
      return { error: "Tipo de umbral inválido." };
    }
    threshold_type = thRaw;
    const thValueRaw = str(formData, "threshold_value");
    const parsed = parseFloat(thValueRaw);
    if (!Number.isFinite(parsed)) {
      return { error: "Valor de umbral inválido." };
    }
    if (threshold_type === "payment_count") {
      if (!Number.isInteger(parsed) || parsed < 1) {
        return { error: "El umbral por cantidad de pagos debe ser un entero >= 1." };
      }
    } else {
      if (parsed <= 0 || parsed > 1) {
        return { error: "El umbral por proporción debe estar entre 0 y 1." };
      }
    }
    threshold_value = parsed;
  }

  const tiersParsed = parseTiers(formData);
  if (typeof tiersParsed === "string") return { error: tiersParsed };
  const validationError = validateTiers(tiersParsed);
  if (validationError) return { error: validationError };

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_commission_rule" as never, {
    p_project_id: projectId,
    p_launch_id: launch_id,
    p_accrual_mode: accrual_mode,
    p_threshold_type: threshold_type,
    p_threshold_value: threshold_value,
    p_modality_ids: modalityIds,
    p_tiers: tiersParsed,
  } as never);

  if (error) {
    // El trigger del pivot lanza con SQLSTATE 23505 si una modalidad ya
    // tiene regla para el mismo (project, launch).
    if (error.code === "23505") {
      return {
        error:
          "Una de las modalidades elegidas ya tiene regla para ese lanzamiento.",
      };
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
  // ON DELETE CASCADE de tiers y pivot se encarga del resto.
  await supabase
    .from("commission_rules")
    .delete()
    .eq("id", ruleId)
    .eq("project_id", projectId);
  revalidatePath(`/proyectos/${projectId}/comisiones`);
}
