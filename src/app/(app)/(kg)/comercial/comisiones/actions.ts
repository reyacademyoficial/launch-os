"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import type {
  AccrualMode,
  CommissionTierType,
  ThresholdType,
} from "@/lib/commissions/types";

import { translateCommissionError } from "./translate-error";

// ═══════════════════════════════════════════════════════════════════════════
// Server actions para payment_modalities y commission_rules desde Kingrow.
//
// Adaptación directa de las actions de LaunchOS que sustituye. Diferencias:
//   1. `requireRole("superadmin")` en vez de `requireCanEditProject(projectId)`.
//   2. El `projectId` sigue curriado al bindear la action desde la page —
//      pero la page lo obtiene del searchParam `?project=<uuid>` en vez del
//      URL param `/proyectos/[id]/...`. El componente no cambia.
//   3. revalidatePath apunta a `/comercial/comisiones` en vez de la ruta
//      de LaunchOS que ya no existe. También revalida
//      `/proyectos/[id]/leads` porque el selector de modalidad vive dentro
//      del sale-modal — un cambio de regla afecta la comisión calculada de
//      la próxima venta cargada.
//
// La estructura del código y las validaciones se copian tal cual. Motivo:
// la lógica de tiers y XOR de scope está probada y no vale reescribirla.
// ═══════════════════════════════════════════════════════════════════════════

export type CommissionActionState = { ok: true } | { error: string } | null;

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function nullable(value: string): string | null {
  return value === "" ? null : value;
}

function revalidateForProject(projectId: string): void {
  revalidatePath("/comercial/comisiones");
  revalidatePath(`/proyectos/${projectId}/leads`);
  revalidatePath(`/proyectos/${projectId}/cobros`);
  revalidatePath(`/proyectos/${projectId}/ventas`);
  revalidatePath(`/proyectos/${projectId}/launches`, "layout");
}

// ─── payment_modalities ───────────────────────────────────────────────────

export async function createPaymentModality(
  projectId: string,
  _prev: CommissionActionState,
  formData: FormData,
): Promise<CommissionActionState> {
  await requireRole("superadmin");
  const name = str(formData, "name");
  if (!name) return { error: "El nombre es obligatorio." };

  const supabase = await createClient();
  const payload = { project_id: projectId, name, active: true } as never;
  const { error } = await supabase.from("payment_modalities").insert(payload);
  if (error) return { error: translateCommissionError(error) };

  revalidateForProject(projectId);
  return { ok: true };
}

export async function updatePaymentModality(
  projectId: string,
  modalityId: string,
  _prev: CommissionActionState,
  formData: FormData,
): Promise<CommissionActionState> {
  await requireRole("superadmin");
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
  if (error) return { error: translateCommissionError(error) };

  revalidateForProject(projectId);
  return { ok: true };
}

export async function deletePaymentModality(
  projectId: string,
  modalityId: string,
): Promise<void> {
  await requireRole("superadmin");
  const supabase = await createClient();
  await supabase
    .from("payment_modalities")
    .delete()
    .eq("id", modalityId)
    .eq("project_id", projectId);
  revalidateForProject(projectId);
}

// ─── commission_rules ─────────────────────────────────────────────────────

interface TierInput {
  min_count: number;
  max_count: number | null;
  type: CommissionTierType;
  value: number;
  /**
   * Moneda del valor cuando `type='fixed'`. Ignorada en `percent` (el %
   * hereda la moneda de la venta al calcular). Persistimos igual — la
   * migración 0107 defaultea 'ARS' si el caller no lo pasa.
   */
  currency: "ARS" | "USD";
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
  const tiers: TierInput[] = [];
  let i = 0;
  while (formData.has(`tiers[${i}][type]`)) {
    const minRaw = str(formData, `tiers[${i}][min_count]`);
    const maxRaw = str(formData, `tiers[${i}][max_count]`);
    const typeRaw = str(formData, `tiers[${i}][type]`);
    const valueRaw = str(formData, `tiers[${i}][value]`);
    const currencyRaw = str(formData, `tiers[${i}][currency]`);

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
    // currency: default 'ARS' si el form no lo mandó (el drawer sólo lo
    // renderiza cuando type='fixed'; percent no tiene columna de moneda).
    const currency: "ARS" | "USD" =
      currencyRaw === "USD" ? "USD" : "ARS";
    tiers.push({ min_count, max_count, type: typeRaw, value, currency });
    i++;
  }
  return tiers;
}

interface ParsedRuleInput {
  modalityIds: string[];
  launch_id: string | null;
  product_id: string | null;
  accrual_mode: AccrualMode;
  threshold_type: ThresholdType | null;
  threshold_value: number | null;
  tiers: TierInput[];
}

function parseRuleFormData(formData: FormData): ParsedRuleInput | string {
  const modalityIds = formData.getAll("modality_ids").map(String).filter(Boolean);
  if (modalityIds.length === 0) return "Elegí al menos una modalidad.";

  const scope = str(formData, "scope");
  let launch_id: string | null = null;
  let product_id: string | null = null;
  if (scope === "launch") {
    launch_id = nullable(str(formData, "launch_id"));
    if (!launch_id) return "Elegí el lanzamiento al que aplica la regla.";
  } else if (scope === "product") {
    product_id = nullable(str(formData, "product_id"));
    if (!product_id) return "Elegí el producto al que aplica la regla.";
  }

  const accrualRaw = str(formData, "accrual_mode") || "proportional";
  if (
    accrualRaw !== "proportional" &&
    accrualRaw !== "threshold_full" &&
    accrualRaw !== "threshold_proportional" &&
    accrualRaw !== "on_close"
  ) {
    return "Modo de devengamiento inválido.";
  }
  const accrual_mode = accrualRaw as AccrualMode;

  let threshold_type: ThresholdType | null = null;
  let threshold_value: number | null = null;
  const needsThreshold =
    accrual_mode === "threshold_full" ||
    accrual_mode === "threshold_proportional";
  if (needsThreshold) {
    const thRaw = str(formData, "threshold_type");
    if (thRaw !== "payment_count" && thRaw !== "paid_ratio") {
      return "Tipo de umbral inválido.";
    }
    threshold_type = thRaw;
    const parsed = parseFloat(str(formData, "threshold_value"));
    if (!Number.isFinite(parsed)) return "Valor de umbral inválido.";
    if (threshold_type === "payment_count") {
      if (!Number.isInteger(parsed) || parsed < 1) {
        return "El umbral por cantidad de pagos debe ser un entero >= 1.";
      }
    } else if (parsed <= 0 || parsed > 1) {
      return "El umbral por proporción debe estar entre 0 y 1.";
    }
    threshold_value = parsed;
  }

  const tiersParsed = parseTiers(formData);
  if (typeof tiersParsed === "string") return tiersParsed;
  const validationError = validateTiers(tiersParsed);
  if (validationError) return validationError;

  return {
    modalityIds,
    launch_id,
    product_id,
    accrual_mode,
    threshold_type,
    threshold_value,
    tiers: tiersParsed,
  };
}

export async function createCommissionRule(
  projectId: string,
  _prev: CommissionActionState,
  formData: FormData,
): Promise<CommissionActionState> {
  await requireRole("superadmin");

  const parsed = parseRuleFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_commission_rule" as never, {
    p_project_id: projectId,
    p_launch_id: parsed.launch_id,
    p_product_id: parsed.product_id,
    p_accrual_mode: parsed.accrual_mode,
    p_threshold_type: parsed.threshold_type,
    p_threshold_value: parsed.threshold_value,
    p_modality_ids: parsed.modalityIds,
    p_tiers: parsed.tiers,
  } as never);

  if (error) return { error: translateCommissionError(error) };

  revalidateForProject(projectId);
  return { ok: true };
}

export async function updateCommissionRule(
  projectId: string,
  ruleId: string,
  _prev: CommissionActionState,
  formData: FormData,
): Promise<CommissionActionState> {
  await requireRole("superadmin");

  const parsed = parseRuleFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_commission_rule" as never, {
    p_rule_id: ruleId,
    p_launch_id: parsed.launch_id,
    p_product_id: parsed.product_id,
    p_accrual_mode: parsed.accrual_mode,
    p_threshold_type: parsed.threshold_type,
    p_threshold_value: parsed.threshold_value,
    p_modality_ids: parsed.modalityIds,
    p_tiers: parsed.tiers,
  } as never);

  if (error) return { error: translateCommissionError(error) };

  revalidateForProject(projectId);
  return { ok: true };
}

export async function deleteCommissionRule(
  projectId: string,
  ruleId: string,
): Promise<void> {
  await requireRole("superadmin");
  const supabase = await createClient();
  await supabase
    .from("commission_rules")
    .delete()
    .eq("id", ruleId)
    .eq("project_id", projectId);
  revalidateForProject(projectId);
}
