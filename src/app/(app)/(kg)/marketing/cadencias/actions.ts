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
// PK compuesta: (content_owner_id, platform, format). El upsert on conflict
// permite editar una cadencia existente sin traer id — la triada natural es
// única. Para edición (mismo triada) también usamos upsert; para cambiar
// alguno de los 3 campos del key hay que eliminar + crear (no es común).
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
  readonly postsPerDay: number;
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

  const postsPerDayRaw = String(formData.get("posts_per_day") ?? "").trim();
  const postsPerDay = Number.parseInt(postsPerDayRaw, 10);
  if (!Number.isFinite(postsPerDay) || postsPerDay <= 0) {
    return "Posts por día debe ser un número entero mayor a 0.";
  }
  if (postsPerDay > 100) {
    return "Posts por día parece demasiado alto (máximo 100).";
  }

  const allowRepeatAssetRaw = formData.get("allow_repeat_asset");
  const allowRepeatAsset = String(allowRepeatAssetRaw ?? "") === "on";

  const notes = nullIfEmpty(formData.get("notes"));

  return {
    contentOwnerId,
    platform,
    format,
    postsPerDay,
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
    posts_per_day: parsed.postsPerDay,
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
