"use server";

import { revalidatePath } from "next/cache";

import {
  isMarketingPlatform,
  isUploadStatus,
  type MarketingPlatform,
  type UploadStatus,
} from "@/lib/marketing/types";
import { resolveCurrentOrganizationId } from "@/lib/organization/current";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

// ═══════════════════════════════════════════════════════════════════════════
// CRUD de content_uploads (0163).
//
// Un upload = un intento de subida en una plataforma + fecha. NO hay unique
// constraint sobre (asset, platform, scheduled_for) — se permite duplicar
// (retry manual, cadencia con allow_repeat_asset=true, etc.). El "no
// repetir" se enforcea en la UI del picker.
//
// setUploadStatus dispara los triggers 0165:
//   - status='subida' → si el asset tiene source_content_piece_id y el piece
//     está en 'listo_para_subir', pasa a 'publicado'.
//   - piece pasa a 'publicado' con is_daily_recurring=true → clon hermano
//     con scheduled_publish_at + 1 día en 'planificado'.
//
// markUploaded es un helper de la UI para el flujo típico: setea status,
// uploaded_at (opcional, trigger lo pobla si null) y opcional public_url en
// un solo request.
// ═══════════════════════════════════════════════════════════════════════════

export type CreateUploadState =
  | { ok: true; uploadId: string }
  | { error: string }
  | null;

export type UpdateUploadState = { ok: true } | { error: string } | null;

export type SetUploadStatusResult = { ok: true } | { error: string };

export type MarkUploadedResult = { ok: true } | { error: string };

export type DeleteUploadResult = { ok: true } | { error: string };

function nullIfEmpty(value: FormDataEntryValue | null): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length === 0 ? null : trimmed;
}

interface UploadPayload {
  readonly contentAssetId: string;
  readonly platform: MarketingPlatform;
  readonly scheduledFor: string;
  readonly status: UploadStatus;
  readonly publicUrl: string | null;
  readonly notes: string | null;
}

function parseUploadFormData(formData: FormData): UploadPayload | string {
  const contentAssetId = String(formData.get("content_asset_id") ?? "").trim();
  if (contentAssetId.length === 0) return "Elegí un asset para subir.";

  const platform = String(formData.get("platform") ?? "").trim();
  if (!isMarketingPlatform(platform)) return "Plataforma inválida.";

  const scheduledFor = String(formData.get("scheduled_for") ?? "").trim();
  if (scheduledFor.length === 0) return "La fecha de subida es obligatoria.";

  const statusRaw = String(formData.get("status") ?? "planificada").trim();
  if (!isUploadStatus(statusRaw)) return "Estado inválido.";

  const publicUrl = nullIfEmpty(formData.get("public_url"));
  const notes = nullIfEmpty(formData.get("notes"));

  return {
    contentAssetId,
    platform,
    scheduledFor,
    status: statusRaw,
    publicUrl,
    notes,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// createUpload
// ═══════════════════════════════════════════════════════════════════════════

export async function createUpload(
  _prev: CreateUploadState,
  formData: FormData,
): Promise<CreateUploadState> {
  const parsed = parseUploadFormData(formData);
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
    organization_id: organizationId,
    content_asset_id: parsed.contentAssetId,
    platform: parsed.platform,
    scheduled_for: parsed.scheduledFor,
    status: parsed.status,
    public_url: parsed.publicUrl,
    notes: parsed.notes,
    // uploaded_at lo pobla el trigger si status='subida'.
  } as never;

  const { data, error } = await supabase
    .from("content_uploads")
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    if (error.code === "23514") {
      return {
        error:
          "La subida rebotó un guard de coherencia. Verificá que el asset pertenece a tu organización.",
      };
    }
    if (error.code === "23503") {
      return { error: "El asset elegido no existe. Refrescá la página." };
    }
    return { error: error.message };
  }

  const created = data as { id: string } | null;
  if (!created) return { error: "El insert no devolvió fila." };

  revalidatePath("/marketing/subidas");
  revalidatePath("/marketing/planificacion");
  revalidatePath("/marketing/edicion");
  return { ok: true, uploadId: created.id };
}

// ═══════════════════════════════════════════════════════════════════════════
// updateUpload
// ═══════════════════════════════════════════════════════════════════════════

export async function updateUpload(
  uploadId: string,
  _prev: UpdateUploadState,
  formData: FormData,
): Promise<UpdateUploadState> {
  if (!uploadId) return { error: "Falta el id de la subida." };

  const parsed = parseUploadFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createSupabaseClient();
  const payload = {
    content_asset_id: parsed.contentAssetId,
    platform: parsed.platform,
    scheduled_for: parsed.scheduledFor,
    status: parsed.status,
    public_url: parsed.publicUrl,
    notes: parsed.notes,
  } as never;

  const { error } = await supabase
    .from("content_uploads")
    .update(payload)
    .eq("id", uploadId);

  if (error) {
    if (error.code === "23514") {
      return {
        error:
          "La subida rebotó un guard de coherencia. Verificá que el asset pertenece a tu organización.",
      };
    }
    return { error: error.message };
  }

  revalidatePath("/marketing/subidas");
  revalidatePath("/marketing/planificacion");
  revalidatePath("/marketing/edicion");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// setUploadStatus — toggle rápido inline en la tabla.
//
// Pasar a 'subida' dispara los triggers 0165 (piece → publicado + regenerar
// hermano diario si aplica). El trigger 0163 pobla uploaded_at.
// ═══════════════════════════════════════════════════════════════════════════

export async function setUploadStatus(
  uploadId: string,
  nextStatus: string,
): Promise<SetUploadStatusResult> {
  if (!uploadId) return { error: "Falta el id de la subida." };
  if (!isUploadStatus(nextStatus)) return { error: "Estado inválido." };

  const supabase = await createSupabaseClient();
  const payload = { status: nextStatus } as never;
  const { error } = await supabase
    .from("content_uploads")
    .update(payload)
    .eq("id", uploadId);
  if (error) return { error: error.message };

  revalidatePath("/marketing/subidas");
  revalidatePath("/marketing/planificacion");
  revalidatePath("/marketing/edicion");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// markUploaded — helper para el flujo típico "marcar como subido".
//
// Setea status='subida' + public_url opcional en un solo request. Si el
// operador no pasó public_url, queda null (se puede completar después).
// ═══════════════════════════════════════════════════════════════════════════

export async function markUploaded(
  uploadId: string,
  publicUrl: string | null,
): Promise<MarkUploadedResult> {
  if (!uploadId) return { error: "Falta el id de la subida." };

  const supabase = await createSupabaseClient();
  const trimmed = publicUrl ? publicUrl.trim() : null;
  const payload = {
    status: "subida" as const,
    public_url: trimmed && trimmed.length > 0 ? trimmed : null,
  } as never;

  const { error } = await supabase
    .from("content_uploads")
    .update(payload)
    .eq("id", uploadId);
  if (error) return { error: error.message };

  revalidatePath("/marketing/subidas");
  revalidatePath("/marketing/planificacion");
  revalidatePath("/marketing/edicion");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// deleteUpload — hard delete.
//
// Bloqueado por el ON DELETE RESTRICT sobre content_asset_id? NO — la FK
// va del upload AL asset, no al revés. Un upload se puede borrar libre.
// El asset queda intacto (y sigue bloqueado para delete si tiene otros
// uploads).
// ═══════════════════════════════════════════════════════════════════════════

export async function deleteUpload(
  uploadId: string,
): Promise<DeleteUploadResult> {
  if (!uploadId) return { error: "Falta el id de la subida." };

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("content_uploads")
    .delete()
    .eq("id", uploadId);
  if (error) return { error: error.message };

  revalidatePath("/marketing/subidas");
  return { ok: true };
}
