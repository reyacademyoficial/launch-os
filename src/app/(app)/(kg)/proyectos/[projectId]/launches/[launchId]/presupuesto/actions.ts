"use server";

import { revalidatePath } from "next/cache";

import { BUDGET_STAGES, type BudgetStage } from "@/lib/budget/types";
import {
  requireCanEditLaunchesIn,
  requireSessionProfile,
} from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export type BudgetActionState = { ok: true } | { error: string } | null;

function budgetPath(projectId: string, launchId: string): string {
  return `/proyectos/${projectId}/launches/${launchId}/presupuesto`;
}

/**
 * Setea la moneda del launch. Acepta cualquier código ISO-4217 de 3 letras
 * mayúsculas (mismo check que el DB). Idempotente: reasignar la misma moneda
 * no toca nada.
 *
 * Peligro operativo: si ya hay entries cargadas con la moneda anterior, no
 * los convierte. Se asume que se setea una sola vez al principio.
 */
export async function setBudgetCurrency(
  projectId: string,
  launchId: string,
  _prev: BudgetActionState,
  formData: FormData,
): Promise<BudgetActionState> {
  await requireCanEditLaunchesIn(projectId);

  const raw = String(formData.get("currency") ?? "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(raw)) {
    return { error: "Moneda inválida. Usá un código de 3 letras (ej: USD)." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("launches")
    .update({ budget_currency: raw } as never)
    .eq("id", launchId)
    .eq("project_id", projectId);
  if (error) return { error: error.message };

  revalidatePath(budgetPath(projectId, launchId));
  return { ok: true };
}

/**
 * Agrega un país al catálogo del proyecto. UNIQUE (project_id, name) bloquea
 * duplicados exactos (23505) — surfaceamos como error específico.
 */
export async function addBudgetCountry(
  projectId: string,
  launchId: string,
  _prev: BudgetActionState,
  formData: FormData,
): Promise<BudgetActionState> {
  const profile = await requireCanEditLaunchesIn(projectId);

  const name = String(formData.get("name") ?? "").trim();
  if (name.length === 0) return { error: "Ingresá un nombre de país." };
  if (name.length > 80) return { error: "Máximo 80 caracteres." };

  const supabase = await createClient();
  const { error } = await supabase.from("budget_countries").insert({
    project_id: projectId,
    name,
    created_by: profile.id,
  } as never);
  if (error) {
    if (error.code === "23505") {
      return { error: "Ese país ya está en la lista." };
    }
    return { error: error.message };
  }

  revalidatePath(budgetPath(projectId, launchId));
  return { ok: true };
}

/**
 * Borra un país del catálogo. El ON DELETE CASCADE en launch_budget_entries
 * limpia todas las entradas de ese país en TODOS los launches del proyecto.
 * La UI muestra un confirm antes de invocar.
 */
export async function deleteBudgetCountry(
  projectId: string,
  launchId: string,
  countryId: string,
): Promise<void> {
  await requireSessionProfile();
  await requireCanEditLaunchesIn(projectId);
  const supabase = await createClient();
  await supabase
    .from("budget_countries")
    .delete()
    .eq("id", countryId)
    .eq("project_id", projectId);
  revalidatePath(budgetPath(projectId, launchId));
}

/**
 * Crea o actualiza el monto de una (launch, etapa, país). Usa el UNIQUE del
 * DB como llave de upsert — un país solo puede aparecer una vez por etapa.
 */
export async function upsertBudgetEntry(
  projectId: string,
  launchId: string,
  _prev: BudgetActionState,
  formData: FormData,
): Promise<BudgetActionState> {
  const profile = await requireCanEditLaunchesIn(projectId);

  const stage = String(formData.get("stage") ?? "").trim();
  const countryId = String(formData.get("country_id") ?? "").trim();
  const amountRaw = String(formData.get("amount") ?? "").trim();

  if (!(BUDGET_STAGES as ReadonlyArray<string>).includes(stage)) {
    return { error: "Etapa inválida." };
  }
  if (countryId.length === 0) {
    return { error: "Elegí un país." };
  }
  const amount = Number(amountRaw);
  if (!Number.isFinite(amount) || amount < 0) {
    return { error: "El monto debe ser un número >= 0." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("launch_budget_entries").upsert(
    {
      launch_id: launchId,
      stage: stage as BudgetStage,
      country_id: countryId,
      amount,
      created_by: profile.id,
    } as never,
    { onConflict: "launch_id,stage,country_id" },
  );
  if (error) return { error: error.message };

  revalidatePath(budgetPath(projectId, launchId));
  return { ok: true };
}

export async function deleteBudgetEntry(
  projectId: string,
  launchId: string,
  entryId: string,
): Promise<void> {
  await requireSessionProfile();
  await requireCanEditLaunchesIn(projectId);
  const supabase = await createClient();
  await supabase
    .from("launch_budget_entries")
    .delete()
    .eq("id", entryId)
    .eq("launch_id", launchId);
  revalidatePath(budgetPath(projectId, launchId));
}
