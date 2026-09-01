"use server";

import { revalidatePath } from "next/cache";

import {
  isMarketingPlatform,
  isUploadStatus,
  type MarketingPlatform,
  type UploadStatus,
} from "@/lib/marketing/types";
import { resolveCurrentPersonId } from "@/lib/ops/current-person";
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
//
// SPLIT LÍDER ⇄ CM (0175). El procedimiento tiene dos manos distintas:
//   - El líder del equipo deja la subida seteada (asset + plataforma +
//     fecha) → `planned_by_person_id` se completa en createUpload.
//   - El community manager confirma que la subió → `uploaded_by_person_id`
//     se completa al pasar a 'subida'.
// No hay rol nuevo en la DB: cualquiera con acceso a Marketing puede hacer
// las dos mitades, pero queda registrado quién hizo cada una. Si la persona
// logueada no tiene fila en `organization_people`, el campo queda null y la
// acción sigue adelante — no bloqueamos la operación por trazabilidad.
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

  // Trazabilidad: quién dejó seteada la subida y, si ya nace 'subida',
  // quién la confirmó. `null` si el usuario no está vinculado a una persona.
  const personId = await resolveCurrentPersonId();

  const supabase = await createSupabaseClient();
  const payload = {
    organization_id: organizationId,
    content_asset_id: parsed.contentAssetId,
    platform: parsed.platform,
    scheduled_for: parsed.scheduledFor,
    status: parsed.status,
    public_url: parsed.publicUrl,
    notes: parsed.notes,
    planned_by_person_id: personId,
    uploaded_by_person_id: parsed.status === "subida" ? personId : null,
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
  // Planificar una subida reserva el asset y baja el stock (0175).
  revalidatePath("/marketing/stock");
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

  // Sólo registramos al CM cuando ESTE update es el que confirma la subida.
  // Sin el chequeo previo, cualquier edición posterior (corregir una nota,
  // pegar el permalink) le robaría la autoría a quien realmente subió.
  const { data: currentRaw } = await supabase
    .from("content_uploads")
    .select("status")
    .eq("id", uploadId)
    .maybeSingle();
  const wasUploaded =
    (currentRaw as { status: string } | null)?.status === "subida";
  const confirmsUpload = parsed.status === "subida" && !wasUploaded;

  const payload = {
    content_asset_id: parsed.contentAssetId,
    platform: parsed.platform,
    scheduled_for: parsed.scheduledFor,
    status: parsed.status,
    public_url: parsed.publicUrl,
    notes: parsed.notes,
    // Al salir de 'subida' lo limpia el trigger `content_uploads_clear_uploader`.
    ...(confirmsUpload
      ? { uploaded_by_person_id: await resolveCurrentPersonId() }
      : {}),
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
  // Planificar una subida reserva el asset y baja el stock (0175).
  revalidatePath("/marketing/stock");
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
  // Al confirmar la subida registramos al CM. Al revertirla, el trigger
  // `content_uploads_clear_uploader` (0175) limpia el campo solo.
  const payload =
    nextStatus === "subida"
      ? {
          status: nextStatus,
          uploaded_by_person_id: await resolveCurrentPersonId(),
        }
      : { status: nextStatus };
  const { error } = await supabase
    .from("content_uploads")
    .update(payload as never)
    .eq("id", uploadId);
  if (error) return { error: error.message };

  revalidatePath("/marketing/subidas");
  revalidatePath("/marketing/planificacion");
  revalidatePath("/marketing/edicion");
  // Planificar una subida reserva el asset y baja el stock (0175).
  revalidatePath("/marketing/stock");
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
    // Quien aprieta este botón es el CM confirmando la publicación.
    uploaded_by_person_id: await resolveCurrentPersonId(),
  } as never;

  const { error } = await supabase
    .from("content_uploads")
    .update(payload)
    .eq("id", uploadId);
  if (error) return { error: error.message };

  revalidatePath("/marketing/subidas");
  revalidatePath("/marketing/planificacion");
  revalidatePath("/marketing/edicion");
  // Planificar una subida reserva el asset y baja el stock (0175).
  revalidatePath("/marketing/stock");
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
  revalidatePath("/marketing/stock");
  return { ok: true };
}
