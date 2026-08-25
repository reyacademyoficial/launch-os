"use server";

import { revalidatePath } from "next/cache";

import { resolveCurrentOrganizationId } from "@/lib/organization/current";
import {
  isMarketingFormat,
  type MarketingFormat,
} from "@/lib/marketing/types";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

// ═══════════════════════════════════════════════════════════════════════════
// CRUD de content_assets (0162).
//
// Un asset representa una pieza EDITADA. Setear `edited_at` dispara el
// trigger `content_piece_stage_from_asset` (0162) que avanza el piece
// origen a `listo_para_subir` — no hay que empujarlo desde el server.
//
// El drawer soporta "marcar como editado ahora" desde el checkbox. Si el
// asset se creó sin `edited_at` y después se marca, el UPDATE también
// dispara el trigger.
//
// Delete es hard delete (aún no existen uploads que dependan). Cuando entre
// 0163, el ON DELETE RESTRICT sobre content_asset_id va a bloquear borrar
// un asset con uploads.
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
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// createProductionBatch — bulk insert de N assets desde una misma sesión.
//
// Uso típico: el editor termina el corte de una grabación y registra en un
// solo submit los "3 reels + 2 nuggets + 1 short" que salieron. Todos
// comparten owner + session + drive_folder_url, y por default se marcan como
// editados (edited_at = ahora). Cada fila lleva su nombre exacto (el del
// archivo en Drive), formato, editor opcional, duración opcional y
// drive_asset_url opcional (link al archivo puntual).
//
// La sesión de origen (`source_recording_session_id`) es obligatoria — este
// action es específico del flujo post-grabación. Para importar assets
// huérfanos (video de stock, etc.) usar `createAsset` singular.
//
// Trigger 0165: al insert con edited_at seteado, cada asset dispara la
// transición de su piece origen (si tiene) a `listo_para_subir`. Los assets
// que no tienen piece (Opción 3A confirmada) simplemente entran al stock.
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
  /** Si se omite, cada asset queda con edited_at = ahora. */
  readonly editedAt: string | null;
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

  const supabase = await createSupabaseClient();
  const editedAt = input.editedAt ?? new Date().toISOString();

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
    edited_at: editedAt,
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
  return { ok: true };
}
