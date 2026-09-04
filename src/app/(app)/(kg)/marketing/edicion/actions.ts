"use server";

import { revalidatePath } from "next/cache";

import { resolveCurrentOrganizationId } from "@/lib/organization/current";
import {
  isMarketingFormat,
  type MarketingFormat,
} from "@/lib/marketing/types";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

// ═══════════════════════════════════════════════════════════════════════════
// CRUD de content_edits (0180) — eventos de edición: "editar tal crudo".
//
// Un evento nace EN COLA (`completed_at = null`) con editor y fecha objetivo
// opcionales. `completeContentEdit` lo cierra: carga en el mismo acto los
// content_assets de salida (los archivos editados que salieron de esa
// edición) y setea `completed_at`. Reemplaza al viejo
// `createProductionBatch`, que saltaba directo de la sesión de grabación al
// archivo final sin pasar por crudo ni por un evento de edición real.
//
// `reopenContentEdit` es la salida de emergencia (error de dedo) — limpia
// `completed_at` pero NO borra los archivos ya cargados. Bloqueada si algún
// archivo producido ya tiene subidas comprometidas, mismo criterio que tenía
// `unmarkAssetEdited` en el modelo viejo.
// ═══════════════════════════════════════════════════════════════════════════

export type CreateEditState =
  | { ok: true; editId: string }
  | { error: string }
  | null;

export type UpdateEditState = { ok: true } | { error: string } | null;

export type DeleteEditResult = { ok: true } | { error: string };

export type CompleteEditResult =
  | { ok: true; assetIds: readonly string[] }
  | { error: string };

export type ReopenEditResult = { ok: true } | { error: string };

function nullIfEmpty(value: FormDataEntryValue | null): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length === 0 ? null : trimmed;
}

interface EditPayload {
  readonly contentOwnerId: string;
  readonly sourceContentRawId: string | null;
  readonly title: string;
  readonly editorPersonId: string | null;
  readonly dueDate: string | null;
  readonly notes: string | null;
}

function parseEditFormData(formData: FormData): EditPayload | string {
  const contentOwnerId = String(formData.get("content_owner_id") ?? "").trim();
  if (contentOwnerId.length === 0) return "Elegí un dueño de contenido.";

  const title = String(formData.get("title") ?? "").trim();
  if (title.length === 0) return "El título de la edición es obligatorio.";
  if (title.length > 200) return "El título es demasiado largo (máximo 200 caracteres).";

  const sourceContentRawId = nullIfEmpty(formData.get("source_content_raw_id"));
  const editorPersonId = nullIfEmpty(formData.get("editor_person_id"));

  const dueDate = nullIfEmpty(formData.get("due_date"));
  if (dueDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    return "La fecha objetivo es inválida.";
  }

  const notes = nullIfEmpty(formData.get("notes"));

  return { contentOwnerId, sourceContentRawId, title, editorPersonId, dueDate, notes };
}

// ═══════════════════════════════════════════════════════════════════════════
// createContentEdit
// ═══════════════════════════════════════════════════════════════════════════

export async function createContentEdit(
  _prev: CreateEditState,
  formData: FormData,
): Promise<CreateEditState> {
  const parsed = parseEditFormData(formData);
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
    source_content_raw_id: parsed.sourceContentRawId,
    title: parsed.title,
    editor_person_id: parsed.editorPersonId,
    due_date: parsed.dueDate,
    notes: parsed.notes,
  } as never;

  const { data, error } = await supabase
    .from("content_edits")
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    if (error.code === "23514") {
      return {
        error:
          "La edición rebotó un guard de coherencia. Verificá que el dueño y el crudo pertenecen a tu organización.",
      };
    }
    if (error.code === "23503") {
      return { error: "Alguna referencia (dueño, crudo) no existe. Refrescá la página." };
    }
    return { error: error.message };
  }

  const created = data as { id: string } | null;
  if (!created) return { error: "El insert no devolvió fila." };

  revalidatePath("/marketing/edicion");
  revalidatePath("/marketing/crudos");
  return { ok: true, editId: created.id };
}

// ═══════════════════════════════════════════════════════════════════════════
// updateContentEdit
// ═══════════════════════════════════════════════════════════════════════════

export async function updateContentEdit(
  editId: string,
  _prev: UpdateEditState,
  formData: FormData,
): Promise<UpdateEditState> {
  if (!editId) return { error: "Falta el id de la edición." };

  const parsed = parseEditFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createSupabaseClient();
  const payload = {
    content_owner_id: parsed.contentOwnerId,
    source_content_raw_id: parsed.sourceContentRawId,
    title: parsed.title,
    editor_person_id: parsed.editorPersonId,
    due_date: parsed.dueDate,
    notes: parsed.notes,
  } as never;

  const { error } = await supabase
    .from("content_edits")
    .update(payload)
    .eq("id", editId);

  if (error) {
    if (error.code === "23514") {
      return {
        error:
          "La edición rebotó un guard de coherencia. Verificá que el dueño y el crudo pertenecen a tu organización.",
      };
    }
    return { error: error.message };
  }

  revalidatePath("/marketing/edicion");
  revalidatePath("/marketing/crudos");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// deleteContentEdit — hard delete. Bloqueado por el ON DELETE RESTRICT
// (0181) sobre content_assets.source_content_edit_id: una edición que ya
// produjo archivos no se puede borrar.
// ═══════════════════════════════════════════════════════════════════════════

export async function deleteContentEdit(editId: string): Promise<DeleteEditResult> {
  if (!editId) return { error: "Falta el id de la edición." };

  const supabase = await createSupabaseClient();
  const { error } = await supabase.from("content_edits").delete().eq("id", editId);
  if (error) {
    if (error.code === "23503") {
      return {
        error:
          "Esta edición ya produjo archivos y no se puede borrar. Borrá los archivos primero desde Stock.",
      };
    }
    return { error: error.message };
  }

  revalidatePath("/marketing/edicion");
  revalidatePath("/marketing/crudos");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// completeContentEdit — "Marcar como realizada".
//
// Carga en un solo submit los N archivos que salieron de la edición
// (content_assets con source_content_edit_id fijo) y cierra el evento
// (content_edits.completed_at). Cada fila puede opcionalmente asociarse a
// una content_piece — a diferencia del viejo createProductionBatch, que
// hardcodeaba `source_content_piece_id: null` para todo el batch y por eso
// las pieces nunca llegaban a `listo_para_subir` por este camino.
//
// INSERT primero, UPDATE de completed_at después: si el insert falla,
// content_edits sigue en cola y el usuario puede reintentar sin duplicar.
// ═══════════════════════════════════════════════════════════════════════════

export interface CompleteEditRow {
  readonly name: string;
  readonly format: MarketingFormat;
  readonly durationSeconds: number | null;
  readonly driveAssetUrl: string | null;
  readonly sourceContentPieceId: string | null;
}

export interface CompleteEditInput {
  readonly contentEditId: string;
  /** null = ahora. */
  readonly completedAt: string | null;
  readonly rows: readonly CompleteEditRow[];
}

export async function completeContentEdit(
  input: CompleteEditInput,
): Promise<CompleteEditResult> {
  if (!input.contentEditId) return { error: "Falta el id de la edición." };
  if (input.rows.length === 0) {
    return { error: "Agregá al menos un archivo editado." };
  }

  for (let i = 0; i < input.rows.length; i++) {
    const r = input.rows[i]!;
    if (!r.name || r.name.trim().length === 0) {
      return { error: `Fila ${i + 1}: el nombre es obligatorio.` };
    }
    if (r.name.length > 200) {
      return { error: `Fila ${i + 1}: nombre demasiado largo (máx 200).` };
    }
    if (!isMarketingFormat(r.format)) {
      return { error: `Fila ${i + 1}: formato inválido.` };
    }
    if (
      r.durationSeconds != null &&
      (!Number.isFinite(r.durationSeconds) || r.durationSeconds <= 0)
    ) {
      return { error: `Fila ${i + 1}: la duración debe ser un entero positivo.` };
    }
  }

  const supabase = await createSupabaseClient();

  const { data: editRow, error: editErr } = await supabase
    .from("content_edits")
    .select("id, organization_id, content_owner_id, completed_at")
    .eq("id", input.contentEditId)
    .maybeSingle();
  if (editErr) return { error: editErr.message };
  const edit = editRow as unknown as
    | {
        readonly id: string;
        readonly organization_id: string;
        readonly content_owner_id: string;
        readonly completed_at: string | null;
      }
    | null;
  if (!edit) return { error: "La edición no existe. Refrescá la página." };
  if (edit.completed_at != null) {
    return { error: "Esta edición ya fue marcada como realizada." };
  }

  const completedAt = input.completedAt ?? new Date().toISOString();

  const payload = input.rows.map((r) => ({
    organization_id: edit.organization_id,
    content_owner_id: edit.content_owner_id,
    source_content_edit_id: edit.id,
    source_content_piece_id: r.sourceContentPieceId,
    name: r.name.trim(),
    format: r.format,
    drive_asset_url: r.driveAssetUrl,
    duration_seconds: r.durationSeconds,
    edited_at: completedAt,
    notes: null,
  })) as never;

  const { data: insertedRaw, error: insertErr } = await supabase
    .from("content_assets")
    .insert(payload)
    .select("id");

  if (insertErr) {
    if (insertErr.code === "23514") {
      return {
        error:
          "Los archivos rebotaron un guard de coherencia. Verificá que la piece elegida pertenece a este dueño.",
      };
    }
    return { error: insertErr.message };
  }

  const { error: closeErr } = await supabase
    .from("content_edits")
    .update({ completed_at: completedAt } as never)
    .eq("id", edit.id);
  if (closeErr) return { error: closeErr.message };

  const inserted = (insertedRaw ?? []) as { id: string }[];

  revalidatePath("/marketing/edicion");
  revalidatePath("/marketing/crudos");
  revalidatePath("/marketing/planificacion");
  revalidatePath("/marketing/stock");
  revalidatePath("/marketing/subidas");
  return { ok: true, assetIds: inserted.map((r) => r.id) };
}

// ═══════════════════════════════════════════════════════════════════════════
// reopenContentEdit — vuelve el evento a la cola (limpia completed_at). Los
// archivos ya cargados NO se borran: es una salida de emergencia para
// corregir un error de dedo, no parte del flujo normal.
// ═══════════════════════════════════════════════════════════════════════════

export async function reopenContentEdit(editId: string): Promise<ReopenEditResult> {
  if (!editId) return { error: "Falta el id de la edición." };

  const supabase = await createSupabaseClient();

  const { data: assetsRaw, error: assetsErr } = await supabase
    .from("content_assets")
    .select("id")
    .eq("source_content_edit_id", editId);
  if (assetsErr) return { error: assetsErr.message };
  const assetIds = ((assetsRaw ?? []) as { id: string }[]).map((a) => a.id);

  if (assetIds.length > 0) {
    const { data: committedRaw, error: committedErr } = await supabase
      .from("content_uploads")
      .select("id")
      .in("content_asset_id", assetIds)
      .in("status", ["planificada", "subida"])
      .limit(1);
    if (committedErr) return { error: committedErr.message };
    if ((committedRaw ?? []).length > 0) {
      return {
        error:
          "Alguno de los archivos de esta edición ya tiene subidas planificadas o publicadas. Cancelá esas subidas primero.",
      };
    }
  }

  const { error } = await supabase
    .from("content_edits")
    .update({ completed_at: null } as never)
    .eq("id", editId);
  if (error) return { error: error.message };

  revalidatePath("/marketing/edicion");
  revalidatePath("/marketing/crudos");
  return { ok: true };
}
