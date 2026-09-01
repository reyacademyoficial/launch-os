"use server";

import { revalidatePath } from "next/cache";

import { resolveCurrentOrganizationId } from "@/lib/organization/current";
import {
  isMarketingFormat,
  type MarketingFormat,
} from "@/lib/marketing/types";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

// ═══════════════════════════════════════════════════════════════════════════
// CRUD de content_assets (0162 + edit_due_date en 0175).
//
// Un asset es un corte que salió de una grabación. Nace EN COLA
// (`edited_at = null`) con un editor asignado y una fecha objetivo
// (`edit_due_date`); cuando el editor lo termina, `markAssetEdited` setea
// `edited_at` y recién ahí el asset entra al stock disponible para subir.
//
// Setear `edited_at` dispara el trigger `content_piece_stage_from_asset`
// (0162) que avanza el piece origen a `listo_para_subir` — no hay que
// empujarlo desde el server.
//
// El drawer soporta "marcar como editado ahora" desde el checkbox. Si el
// asset se creó sin `edited_at` y después se marca, el UPDATE también
// dispara el trigger.
//
// Delete es hard delete, bloqueado por el ON DELETE RESTRICT de 0163 sobre
// content_asset_id: un asset con uploads no se puede borrar.
// ═══════════════════════════════════════════════════════════════════════════

export type CreateAssetState =
  | { ok: true; assetId: string }
  | { error: string }
  | null;

export type UpdateAssetState = { ok: true } | { error: string } | null;

export type DeleteAssetResult = { ok: true } | { error: string };

function nullIfEmpty(value: FormDataEntryValue | null): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length === 0 ? null : trimmed;
}

interface AssetPayload {
  readonly contentOwnerId: string;
  readonly sourceRecordingSessionId: string | null;
  readonly sourceContentPieceId: string | null;
  readonly name: string;
  readonly format: MarketingFormat;
  readonly driveFolderUrl: string | null;
  readonly driveAssetUrl: string | null;
  readonly durationSeconds: number | null;
  readonly editorPersonId: string | null;
  readonly editDueDate: string | null;
  readonly editedAt: string | null;
  readonly notes: string | null;
}

function parseAssetFormData(formData: FormData): AssetPayload | string {
  const contentOwnerId = String(formData.get("content_owner_id") ?? "").trim();
  if (contentOwnerId.length === 0) return "Elegí un dueño de contenido.";

  const name = String(formData.get("name") ?? "").trim();
  if (name.length === 0) return "El nombre del asset es obligatorio.";
  if (name.length > 200) return "El nombre es demasiado largo (máximo 200 caracteres).";

  const format = String(formData.get("format") ?? "").trim();
  if (!isMarketingFormat(format)) return "Formato inválido.";

  const sourceRecordingSessionId = nullIfEmpty(
    formData.get("source_recording_session_id"),
  );
  const sourceContentPieceId = nullIfEmpty(
    formData.get("source_content_piece_id"),
  );

  const durationRaw = String(formData.get("duration_seconds") ?? "").trim();
  let durationSeconds: number | null = null;
  if (durationRaw.length > 0) {
    const n = Number.parseInt(durationRaw, 10);
    if (!Number.isFinite(n) || n <= 0) {
      return "La duración debe ser un entero positivo (segundos).";
    }
    durationSeconds = n;
  }

  const driveFolderUrl = nullIfEmpty(formData.get("drive_folder_url"));
  const driveAssetUrl = nullIfEmpty(formData.get("drive_asset_url"));

  const editorPersonId = nullIfEmpty(formData.get("editor_person_id"));

  // Fecha objetivo de edición (input type="date" → yyyy-mm-dd). Es el bucket
  // del planning semanal; sin ella el asset queda en la columna "Sin fecha".
  const editDueDate = nullIfEmpty(formData.get("edit_due_date"));
  if (editDueDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(editDueDate)) {
    return "La fecha objetivo de edición es inválida.";
  }

  // Checkbox "mark_edited" (marca `edited_at = now()`). Si se desmarca,
  // limpiamos el valor — así se puede "desmarcar por error" en modo edit.
  const markEdited = String(formData.get("mark_edited") ?? "") === "on";
  // Además soportamos un input datetime-local `edited_at_manual` que gana
  // sobre "mark_edited=on" (permite editar la fecha real). El input existe
  // solo cuando "mark_edited" está activo.
  const editedAtManual = nullIfEmpty(formData.get("edited_at_manual"));

  let editedAt: string | null = null;
  if (markEdited) {
    editedAt = editedAtManual ?? new Date().toISOString();
  }

  const notes = nullIfEmpty(formData.get("notes"));

  return {
    contentOwnerId,
    sourceRecordingSessionId,
    sourceContentPieceId,
    name,
    format,
    driveFolderUrl,
    driveAssetUrl,
    durationSeconds,
    editorPersonId,
    editDueDate,
    editedAt,
    notes,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// createAsset
// ═══════════════════════════════════════════════════════════════════════════

export async function createAsset(
  _prev: CreateAssetState,
  formData: FormData,
): Promise<CreateAssetState> {
  const parsed = parseAssetFormData(formData);
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
    source_content_piece_id: parsed.sourceContentPieceId,
    name: parsed.name,
    format: parsed.format,
    drive_folder_url: parsed.driveFolderUrl,
    drive_asset_url: parsed.driveAssetUrl,
    duration_seconds: parsed.durationSeconds,
    editor_person_id: parsed.editorPersonId,
    edit_due_date: parsed.editDueDate,
    edited_at: parsed.editedAt,
    notes: parsed.notes,
  } as never;

  const { data, error } = await supabase
    .from("content_assets")
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    if (error.code === "23514") {
      return {
        error:
          "El asset rebotó un guard de coherencia. Verificá que el dueño, la sesión y la piece origen pertenecen a tu organización.",
      };
    }
    if (error.code === "23503") {
      return { error: "Alguna referencia (dueño, sesión, piece) no existe. Refrescá la página." };
    }
    return { error: error.message };
  }

  const created = data as { id: string } | null;
  if (!created) return { error: "El insert no devolvió fila." };

  revalidatePath("/marketing/edicion");
  revalidatePath("/marketing/planificacion");
  revalidatePath("/marketing/stock");
  revalidatePath("/marketing/subidas");
  return { ok: true, assetId: created.id };
}

// ═══════════════════════════════════════════════════════════════════════════
// updateAsset
// ═══════════════════════════════════════════════════════════════════════════

export async function updateAsset(
  assetId: string,
  _prev: UpdateAssetState,
  formData: FormData,
): Promise<UpdateAssetState> {
  if (!assetId) return { error: "Falta el id del asset." };

  const parsed = parseAssetFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createSupabaseClient();

  // Destildar "Asset editado" lo devuelve a la cola y lo saca del stock. No
  // se puede hacer si ya hay subidas comprometidas: dejaría una subida
  // apuntando a un corte que oficialmente no existe todavía. Mismo guard
  // que `unmarkAssetEdited`, acá porque el drawer es otra puerta al mismo
  // cambio.
  if (parsed.editedAt == null) {
    const { data: committed, error: committedErr } = await supabase
      .from("content_uploads")
      .select("id")
      .eq("content_asset_id", assetId)
      .in("status", ["planificada", "subida"])
      .limit(1);
    if (committedErr) return { error: committedErr.message };
    if ((committed ?? []).length > 0) {
      return {
        error:
          "Este asset ya tiene subidas planificadas o publicadas: no se puede desmarcar como editado. Cancelá esas subidas primero.",
      };
    }
  }

  const payload = {
    content_owner_id: parsed.contentOwnerId,
    source_recording_session_id: parsed.sourceRecordingSessionId,
    source_content_piece_id: parsed.sourceContentPieceId,
    name: parsed.name,
    format: parsed.format,
    drive_folder_url: parsed.driveFolderUrl,
    drive_asset_url: parsed.driveAssetUrl,
    duration_seconds: parsed.durationSeconds,
    editor_person_id: parsed.editorPersonId,
    edit_due_date: parsed.editDueDate,
    edited_at: parsed.editedAt,
    notes: parsed.notes,
  } as never;

  const { error } = await supabase
    .from("content_assets")
    .update(payload)
    .eq("id", assetId);

  if (error) {
    if (error.code === "23514") {
      return {
        error:
          "El asset rebotó un guard de coherencia. Verificá que el dueño, la sesión y la piece origen pertenecen a tu organización.",
      };
    }
    return { error: error.message };
  }

  revalidatePath("/marketing/edicion");
  revalidatePath("/marketing/planificacion");
  revalidatePath("/marketing/stock");
  revalidatePath("/marketing/subidas");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// createProductionBatch — bulk insert de N assets desde una misma sesión.
//
// Uso típico: terminada la grabación, se registran en un solo submit los
// "3 reels + 2 nuggets + 1 short" que salieron en crudo. Todos comparten
// owner + session + drive_folder_url + fecha objetivo de edición. Cada fila
// lleva su nombre exacto (el del archivo en Drive), formato, editor
// opcional, duración opcional y drive_asset_url opcional.
//
// Los assets entran EN COLA: `edited_at = null`. No son stock todavía —
// alguien los tiene que editar y marcar terminados desde /marketing/edicion.
// Ésa es la diferencia con el comportamiento previo, que los daba por
// editados en el mismo acto de registrarlos y hacía que la etapa Edición
// no existiera de hecho.
//
// La sesión de origen (`source_recording_session_id`) es obligatoria — este
// action es específico del flujo post-grabación. Para importar assets
// huérfanos (video de stock, etc.) usar `createAsset` singular.
//
// Trigger 0162: la transición del piece origen a `listo_para_subir` la
// dispara `edited_at`, así que con el batch en cola no se dispara acá —
// ocurre después, cuando el editor llama a `markAssetEdited`.
//
// Se hace un solo INSERT con array de payloads para minimizar RTT. Si un row
// rebota (guard org, formato inválido), postgrest devuelve error y NINGÚN row
// se inserta — es un all-or-nothing por transacción implícita del REST.
// ═══════════════════════════════════════════════════════════════════════════

export interface ProductionBatchRow {
  readonly name: string;
  readonly format: MarketingFormat;
  readonly editorPersonId: string | null;
  readonly durationSeconds: number | null;
  readonly driveAssetUrl: string | null;
}

export interface ProductionBatchInput {
  readonly sourceRecordingSessionId: string;
  readonly contentOwnerId: string;
  readonly driveFolderUrl: string | null;
  /**
   * Fecha objetivo de edición (yyyy-mm-dd) compartida por todo el batch —
   * "esto tiene que estar editado para el viernes". Nullable: los assets sin
   * fecha caen en la columna "Sin fecha" del planning semanal.
   */
  readonly editDueDate: string | null;
  readonly rows: readonly ProductionBatchRow[];
}

export type CreateProductionBatchResult =
  | { ok: true; assetIds: readonly string[] }
  | { error: string };

export async function createProductionBatch(
  input: ProductionBatchInput,
): Promise<CreateProductionBatchResult> {
  if (!input.sourceRecordingSessionId) {
    return { error: "Falta la sesión de grabación de origen." };
  }
  if (!input.contentOwnerId) {
    return { error: "Falta el dueño de contenido." };
  }
  if (input.rows.length === 0) {
    return { error: "Agregá al menos un asset a la producción." };
  }

  // Validación defensiva por fila. La UI ya valida pero un submit manipulado
  // podría burlarla — reafirmamos.
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

  if (
    input.editDueDate != null &&
    !/^\d{4}-\d{2}-\d{2}$/.test(input.editDueDate)
  ) {
    return { error: "La fecha objetivo de edición es inválida." };
  }

  const supabase = await createSupabaseClient();

  const payload = input.rows.map((r) => ({
    organization_id: organizationId,
    content_owner_id: input.contentOwnerId,
    source_recording_session_id: input.sourceRecordingSessionId,
    // Opción 3A: no atamos a piece; la trazabilidad la da la session.
    source_content_piece_id: null,
    name: r.name.trim(),
    format: r.format,
    drive_folder_url: input.driveFolderUrl,
    drive_asset_url: r.driveAssetUrl,
    duration_seconds: r.durationSeconds,
    editor_person_id: r.editorPersonId,
    edit_due_date: input.editDueDate,
    // En cola: el corte existe pero todavía no está editado.
    edited_at: null,
    notes: null,
  })) as never;

  const { data, error } = await supabase
    .from("content_assets")
    .insert(payload)
    .select("id");

  if (error) {
    if (error.code === "23514") {
      return {
        error:
          "El batch rebotó un guard de coherencia. Verificá que la sesión y el dueño pertenecen a tu organización.",
      };
    }
    if (error.code === "23503") {
      return { error: "La sesión o el dueño no existen. Refrescá la página." };
    }
    return { error: error.message };
  }

  const rows = (data ?? []) as { id: string }[];
  revalidatePath("/marketing/edicion");
  revalidatePath("/marketing/stock");
  revalidatePath("/marketing/grabacion");
  revalidatePath("/marketing/planificacion");
  return { ok: true, assetIds: rows.map((r) => r.id) };
}

// ═══════════════════════════════════════════════════════════════════════════
// markAssetEdited / unmarkAssetEdited — cierre (y reapertura) de la etapa
// de edición desde la fila de la tabla, sin abrir el drawer completo.
//
// Marcar dispara el trigger 0162 `content_piece_stage_from_asset`: si el
// asset tiene piece origen en `en_edicion`, pasa a `listo_para_subir`. Y a
// partir de acá el asset cuenta como stock disponible en /marketing/stock y
// aparece en el picker de /marketing/subidas.
//
// Desmarcar existe para el error de dedo. Postgres no revierte el stage del
// piece (el trigger sólo avanza), así que es una salida de emergencia, no
// parte del flujo normal — por eso no la ofrecemos sobre assets que ya
// tienen subidas planificadas o hechas.
// ═══════════════════════════════════════════════════════════════════════════

export type MarkAssetEditedResult = { ok: true } | { error: string };

async function setAssetEditedAt(
  assetId: string,
  editedAt: string | null,
): Promise<MarkAssetEditedResult> {
  if (!assetId) return { error: "Falta el id del asset." };

  const supabase = await createSupabaseClient();
  const payload = { edited_at: editedAt } as never;
  const { error } = await supabase
    .from("content_assets")
    .update(payload)
    .eq("id", assetId);
  if (error) return { error: error.message };

  revalidatePath("/marketing/edicion");
  revalidatePath("/marketing/stock");
  revalidatePath("/marketing/subidas");
  revalidatePath("/marketing/planificacion");
  return { ok: true };
}

export async function markAssetEdited(
  assetId: string,
): Promise<MarkAssetEditedResult> {
  return setAssetEditedAt(assetId, new Date().toISOString());
}

export async function unmarkAssetEdited(
  assetId: string,
): Promise<MarkAssetEditedResult> {
  if (!assetId) return { error: "Falta el id del asset." };

  // Guard: un asset con subidas ya comprometidas no vuelve a la cola —
  // sería mentir sobre algo que el CM quizás ya publicó.
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("content_uploads")
    .select("id")
    .eq("content_asset_id", assetId)
    .in("status", ["planificada", "subida"])
    .limit(1);
  if (error) return { error: error.message };
  if ((data ?? []).length > 0) {
    return {
      error:
        "Este asset ya tiene subidas planificadas o publicadas. Cancelá esas subidas antes de devolverlo a la cola de edición.",
    };
  }

  return setAssetEditedAt(assetId, null);
}

// ═══════════════════════════════════════════════════════════════════════════
// deleteAsset — hard delete.
//
// Sin uploads todavía (0163 pendiente); cuando se agreguen, la FK con
// ON DELETE RESTRICT bloqueará borrar assets con uploads. Por ahora es libre.
// ═══════════════════════════════════════════════════════════════════════════

export async function deleteAsset(
  assetId: string,
): Promise<DeleteAssetResult> {
  if (!assetId) return { error: "Falta el id del asset." };

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("content_assets")
    .delete()
    .eq("id", assetId);
  if (error) {
    if (error.code === "23503") {
      return {
        error:
          "No se puede borrar el asset porque tiene subidas asociadas. Cancelá las subidas primero.",
      };
    }
    return { error: error.message };
  }

  revalidatePath("/marketing/edicion");
  revalidatePath("/marketing/planificacion");
  revalidatePath("/marketing/stock");
  revalidatePath("/marketing/subidas");
  return { ok: true };
}
