"use server";

import { revalidatePath } from "next/cache";

import { resolveCurrentOrganizationId } from "@/lib/organization/current";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import {
  isMarketingFormat,
  isMarketingPlatform,
  type MarketingFormat,
  type MarketingPlatform,
} from "@/lib/marketing/types";

// ═══════════════════════════════════════════════════════════════════════════
// CRUD de publishing_cadences.
//
// PK compuesta: (content_owner_id, platform, format). `upsertCadence` crea
// (o pisa si el usuario re-envía la misma triada). `updateCadence` edita una
// fila EXISTENTE identificándola por su clave original, permitiendo cambiar
// cualquiera de los 3 campos sin borrar y crear de nuevo.
// ═══════════════════════════════════════════════════════════════════════════

export type CreateCadenceState =
  | { ok: true }
  | { error: string }
  | null;

export type UpdateCadenceState = { ok: true } | { error: string } | null;

export type DeleteCadenceResult = { ok: true } | { error: string };

function nullIfEmpty(value: FormDataEntryValue | null): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length === 0 ? null : trimmed;
}

interface CadencePayload {
  readonly contentOwnerId: string;
  readonly platform: MarketingPlatform;
  readonly format: MarketingFormat;
  readonly timesCount: number;
  readonly periodDays: number;
  readonly allowRepeatAsset: boolean;
  readonly notes: string | null;
}

function parseCadenceFormData(formData: FormData): CadencePayload | string {
  const contentOwnerId = String(formData.get("content_owner_id") ?? "").trim();
  if (contentOwnerId.length === 0) return "Elegí un dueño de contenido.";

  const platform = String(formData.get("platform") ?? "").trim();
  if (!isMarketingPlatform(platform)) return "Plataforma inválida.";

  const format = String(formData.get("format") ?? "").trim();
  if (!isMarketingFormat(format)) return "Formato inválido.";

  const timesCountRaw = String(formData.get("times_count") ?? "").trim();
  const timesCount = Number.parseInt(timesCountRaw, 10);
  if (!Number.isFinite(timesCount) || timesCount <= 0) {
    return "La cantidad debe ser un número entero mayor a 0.";
  }
  if (timesCount > 100) {
    return "La cantidad parece demasiado alta (máximo 100).";
  }

  const periodDaysRaw = String(formData.get("period_days") ?? "").trim();
  const periodDays = Number.parseInt(periodDaysRaw, 10);
  if (!Number.isFinite(periodDays) || periodDays <= 0) {
    return "El período (cada cuántos días) debe ser un número entero mayor a 0.";
  }
  if (periodDays > 90) {
    return "El período parece demasiado largo (máximo 90 días).";
  }

  const allowRepeatAssetRaw = formData.get("allow_repeat_asset");
  const allowRepeatAsset = String(allowRepeatAssetRaw ?? "") === "on";

  const notes = nullIfEmpty(formData.get("notes"));

  return {
    contentOwnerId,
    platform,
    format,
    timesCount,
    periodDays,
    allowRepeatAsset,
    notes,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// upsertCadence — crea o actualiza por (owner, platform, format).
// ═══════════════════════════════════════════════════════════════════════════

export async function upsertCadence(
  _prev: CreateCadenceState,
  formData: FormData,
): Promise<CreateCadenceState> {
  const parsed = parseCadenceFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  let organizationId: string | null;
  try {
    organizationId = await resolveCurrentOrganizationId();
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Error resolviendo la organización.",
    };
  }
  if (!organizationId) {
    return { error: "No pudimos resolver tu organización. Revisá tus permisos." };
  }

  const supabase = await createSupabaseClient();
  const payload = {
    content_owner_id: parsed.contentOwnerId,
    platform: parsed.platform,
    format: parsed.format,
    organization_id: organizationId,
    times_count: parsed.timesCount,
    period_days: parsed.periodDays,
    allow_repeat_asset: parsed.allowRepeatAsset,
    notes: parsed.notes,
  } as never;

  const { error } = await supabase
    .from("publishing_cadences")
    .upsert(payload, { onConflict: "content_owner_id,platform,format" });

  if (error) {
    // 23514 = check constraint (org mismatch por trigger de 0158, o postsPerDay).
    if (error.code === "23514") {
      return {
        error:
          "La cadencia rebotó un guard de coherencia. Verificá que el dueño pertenece a tu organización.",
      };
    }
    // 23503 = FK (content_owner_id no existe).
    if (error.code === "23503") {
      return { error: "El dueño elegido no existe. Refrescá la página." };
    }
    return { error: error.message };
  }

  revalidatePath("/marketing/cadencias");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// updateCadence — edita la fila identificada por su clave ORIGINAL
// (contentOwnerId/platform/format previos), permitiendo cambiar cualquiera
// de esos 3 campos sin borrar y crear de nuevo. Si la clave nueva ya
// pertenece a otra cadencia, el PK compuesto rebota (23505).
// ═══════════════════════════════════════════════════════════════════════════

export async function updateCadence(
  originalOwnerId: string,
  originalPlatform: string,
  originalFormat: string,
  _prev: UpdateCadenceState,
  formData: FormData,
): Promise<UpdateCadenceState> {
  if (!originalOwnerId || !originalPlatform || !originalFormat) {
    return { error: "Falta la clave original de la cadencia." };
  }

  const parsed = parseCadenceFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createSupabaseClient();
  const payload = {
    content_owner_id: parsed.contentOwnerId,
    platform: parsed.platform,
    format: parsed.format,
    times_count: parsed.timesCount,
    period_days: parsed.periodDays,
    allow_repeat_asset: parsed.allowRepeatAsset,
    notes: parsed.notes,
  } as never;

  const { error } = await supabase
    .from("publishing_cadences")
    .update(payload)
    .eq("content_owner_id", originalOwnerId)
    .eq("platform", originalPlatform)
    .eq("format", originalFormat);

  if (error) {
    if (error.code === "23505") {
      return {
        error:
          "Ya existe una cadencia para ese dueño, plataforma y formato. Editá la existente en vez de duplicarla.",
      };
    }
    if (error.code === "23514") {
      return {
        error:
          "La cadencia rebotó un guard de coherencia. Verificá que el dueño pertenece a tu organización.",
      };
    }
    if (error.code === "23503") {
      return { error: "El dueño elegido no existe. Refrescá la página." };
    }
    return { error: error.message };
  }

  revalidatePath("/marketing/cadencias");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// deleteCadence — borra por PK compuesta.
//
// Cadencias son configuración, no historial. Borrar es seguro (no destruye
// contenido; solo remueve la regla de cálculo del stock).
// ═══════════════════════════════════════════════════════════════════════════

export async function deleteCadence(
  contentOwnerId: string,
  platform: string,
  format: string,
): Promise<DeleteCadenceResult> {
  if (!contentOwnerId) return { error: "Falta el id del dueño." };
  if (!isMarketingPlatform(platform)) return { error: "Plataforma inválida." };
  if (!isMarketingFormat(format)) return { error: "Formato inválido." };

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("publishing_cadences")
    .delete()
    .eq("content_owner_id", contentOwnerId)
    .eq("platform", platform)
    .eq("format", format);

  if (error) return { error: error.message };

  revalidatePath("/marketing/cadencias");
  return { ok: true };
}
