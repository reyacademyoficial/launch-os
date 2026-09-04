"use server";

import { revalidatePath } from "next/cache";

import { resolveCurrentOrganizationId } from "@/lib/organization/current";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

// ═══════════════════════════════════════════════════════════════════════════
// CRUD de content_raws (0179) — Crudos.
//
// Material sin editar. Puede venir de una recording_session (típico: se
// carga apenas termina la grabación) o suelto (source_recording_session_id
// null — importación, cámara que no pasó por una sesión registrada).
//
// De acá sale Edición: un content_edit se arma "sobre" un crudo
// (source_content_raw_id). Borrar un crudo no bloquea nada — los eventos de
// edición que lo referencian quedan con source_content_raw_id = null
// (ON DELETE SET NULL, 0180), igual que una sesión borrada no arrastra sus
// pieces.
// ═══════════════════════════════════════════════════════════════════════════

export type CreateRawState =
  | { ok: true; rawId: string }
  | { error: string }
  | null;

export type UpdateRawState = { ok: true } | { error: string } | null;

export type DeleteRawResult = { ok: true } | { error: string };

function nullIfEmpty(value: FormDataEntryValue | null): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length === 0 ? null : trimmed;
}

interface RawPayload {
  readonly contentOwnerId: string;
  readonly sourceRecordingSessionId: string | null;
  readonly name: string;
  readonly driveUrl: string;
  readonly notes: string | null;
}

function parseRawFormData(formData: FormData): RawPayload | string {
  const contentOwnerId = String(formData.get("content_owner_id") ?? "").trim();
  if (contentOwnerId.length === 0) return "Elegí un dueño de contenido.";

  const name = String(formData.get("name") ?? "").trim();
  if (name.length === 0) return "El nombre del crudo es obligatorio.";
  if (name.length > 200) return "El nombre es demasiado largo (máximo 200 caracteres).";

  const driveUrl = String(formData.get("drive_url") ?? "").trim();
  if (driveUrl.length === 0) return "El link al crudo es obligatorio.";

  const sourceRecordingSessionId = nullIfEmpty(
    formData.get("source_recording_session_id"),
  );

  const notes = nullIfEmpty(formData.get("notes"));

  return { contentOwnerId, sourceRecordingSessionId, name, driveUrl, notes };
}

// ═══════════════════════════════════════════════════════════════════════════
// createRaw
// ═══════════════════════════════════════════════════════════════════════════

export async function createRaw(
  _prev: CreateRawState,
  formData: FormData,
): Promise<CreateRawState> {
  const parsed = parseRawFormData(formData);
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
    content_owner_id: parsed.contentOwnerId,
    source_recording_session_id: parsed.sourceRecordingSessionId,
    name: parsed.name,
    drive_url: parsed.driveUrl,
    notes: parsed.notes,
  } as never;

  const { data, error } = await supabase
    .from("content_raws")
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    if (error.code === "23514") {
      return {
        error:
          "El crudo rebotó un guard de coherencia. Verificá que el dueño y la sesión pertenecen a tu organización.",
      };
    }
    if (error.code === "23503") {
      return { error: "Alguna referencia (dueño, sesión) no existe. Refrescá la página." };
    }
    return { error: error.message };
  }

  const created = data as { id: string } | null;
  if (!created) return { error: "El insert no devolvió fila." };

  revalidatePath("/marketing/crudos");
  revalidatePath("/marketing/grabacion");
  revalidatePath("/marketing/edicion");
  return { ok: true, rawId: created.id };
}

// ═══════════════════════════════════════════════════════════════════════════
// updateRaw
// ═══════════════════════════════════════════════════════════════════════════

export async function updateRaw(
  rawId: string,
  _prev: UpdateRawState,
  formData: FormData,
): Promise<UpdateRawState> {
  if (!rawId) return { error: "Falta el id del crudo." };

  const parsed = parseRawFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createSupabaseClient();
  const payload = {
    content_owner_id: parsed.contentOwnerId,
    source_recording_session_id: parsed.sourceRecordingSessionId,
    name: parsed.name,
    drive_url: parsed.driveUrl,
    notes: parsed.notes,
  } as never;

  const { error } = await supabase
    .from("content_raws")
    .update(payload)
    .eq("id", rawId);

  if (error) {
    if (error.code === "23514") {
      return {
        error:
          "El crudo rebotó un guard de coherencia. Verificá que el dueño y la sesión pertenecen a tu organización.",
      };
    }
    return { error: error.message };
  }

  revalidatePath("/marketing/crudos");
  revalidatePath("/marketing/grabacion");
  revalidatePath("/marketing/edicion");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// deleteRaw — hard delete. Libre: content_edits.source_content_raw_id es
// ON DELETE SET NULL (0180), así que borrar un crudo no bloquea ediciones ya
// creadas sobre él — sólo pierden el vínculo de origen, igual que borrar una
// recording_session desata sus pieces.
// ═══════════════════════════════════════════════════════════════════════════

export async function deleteRaw(rawId: string): Promise<DeleteRawResult> {
  if (!rawId) return { error: "Falta el id del crudo." };

  const supabase = await createSupabaseClient();
  const { error } = await supabase.from("content_raws").delete().eq("id", rawId);
  if (error) return { error: error.message };

  revalidatePath("/marketing/crudos");
  revalidatePath("/marketing/grabacion");
  revalidatePath("/marketing/edicion");
  return { ok: true };
}
