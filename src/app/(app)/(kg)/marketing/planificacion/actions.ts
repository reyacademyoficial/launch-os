"use server";

import { revalidatePath } from "next/cache";

import { resolveCurrentOrganizationId } from "@/lib/organization/current";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import {
  isMarketingCategory,
  isMarketingFormat,
  isMarketingPlatform,
  isMarketingStage,
  MARKETING_PLATFORMS,
  type MarketingCategory,
  type MarketingFormat,
  type MarketingPlatform,
  type MarketingStage,
} from "@/lib/marketing/types";

// ═══════════════════════════════════════════════════════════════════════════
// CRUD de content_pieces.
//
// Sin borrado duro por defecto: descartar → stage='descartado'. `deletePiece`
// existe pero solo permite borrar pieces que aún están en 'planificado' y
// sin recording_session_id (piezas creadas por error). Cualquier piece que
// ya haya avanzado en el pipeline no se puede borrar — descartar en su lugar.
//
// setStage manual sirve para "descartar" desde la UI (chip rojo). Las
// transiciones "hacia adelante" (planificado → en_grabacion, etc.) las
// dispara el trigger de 0165 automáticamente cuando la etapa correspondiente
// se completa. Nunca se llama setStage para avanzar.
// ═══════════════════════════════════════════════════════════════════════════

export type CreatePieceState =
  | { ok: true; pieceId: string }
  | { error: string }
  | null;

export type UpdatePieceState = { ok: true } | { error: string } | null;

export type SetStageResult = { ok: true } | { error: string };

export type DeletePieceResult = { ok: true } | { error: string };

function nullIfEmpty(value: FormDataEntryValue | null): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Un `<input type="datetime-local">` envía "YYYY-MM-DDTHH:mm" (sin tz).
 * Lo tratamos como timestamp local del server — postgres lo parsea como
 * timestamptz asumiendo la zona del server. Aceptable para un plan editorial
 * (no requiere precisión sub-diaria cross-tz).
 */
function nullIfEmptyDateTime(value: FormDataEntryValue | null): string | null {
  const raw = String(value ?? "").trim();
  if (raw.length === 0) return null;
  return raw;
}

function nullIfEmptyDate(value: FormDataEntryValue | null): string | null {
  const raw = String(value ?? "").trim();
  if (raw.length === 0) return null;
  return raw;
}

interface PiecePayload {
  readonly contentOwnerId: string;
  readonly title: string;
  readonly scriptMd: string | null;
  readonly category: MarketingCategory;
  readonly format: MarketingFormat;
  readonly platforms: readonly MarketingPlatform[];
  readonly scheduledRecordingAt: string | null;
  readonly scheduledPublishAt: string | null;
  readonly isDailyRecurring: boolean;
  readonly notes: string | null;
}

function parsePieceFormData(formData: FormData): PiecePayload | string {
  const contentOwnerId = String(formData.get("content_owner_id") ?? "").trim();
  if (contentOwnerId.length === 0) return "Elegí un dueño de contenido.";

  const title = String(formData.get("title") ?? "").trim();
  if (title.length === 0) return "El título es obligatorio.";
  if (title.length > 200) return "El título es demasiado largo (máximo 200 caracteres).";

  const scriptMd = nullIfEmpty(formData.get("script_md"));

  const category = String(formData.get("category") ?? "").trim();
  if (!isMarketingCategory(category)) return "Categoría inválida.";

  const format = String(formData.get("format") ?? "").trim();
  if (!isMarketingFormat(format)) return "Formato inválido.";

  // Plataformas llegan como checkboxes con name="platforms" (múltiples).
  // getAll devuelve un array con todos los valores marcados.
  const platformsRaw = formData.getAll("platforms").map((v) => String(v));
  const platforms = platformsRaw.filter((p): p is MarketingPlatform =>
    isMarketingPlatform(p),
  );
  if (platforms.length === 0) {
    return "Elegí al menos una plataforma destino.";
  }
  // Dedupe defensivo — si el HTML duplica un value por accidente, el CHECK
  // de la DB no lo rechaza pero visualmente es un error. Set preserva orden
  // de aparición.
  const uniquePlatforms = Array.from(new Set(platforms));

  const scheduledRecordingAt = nullIfEmptyDateTime(
    formData.get("scheduled_recording_at"),
  );
  const scheduledPublishAt = nullIfEmptyDate(
    formData.get("scheduled_publish_at"),
  );

  const isDailyRecurringRaw = formData.get("is_daily_recurring");
  const isDailyRecurring = String(isDailyRecurringRaw ?? "") === "on";

  const notes = nullIfEmpty(formData.get("notes"));

  return {
    contentOwnerId,
    title,
    scriptMd,
    category,
    format,
    platforms: uniquePlatforms,
    scheduledRecordingAt,
    scheduledPublishAt,
    isDailyRecurring,
    notes,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// createPiece
// ═══════════════════════════════════════════════════════════════════════════

export async function createPiece(
  _prev: CreatePieceState,
  formData: FormData,
): Promise<CreatePieceState> {
  const parsed = parsePieceFormData(formData);
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
    title: parsed.title,
    script_md: parsed.scriptMd,
    category: parsed.category,
    format: parsed.format,
    platforms: parsed.platforms,
    scheduled_recording_at: parsed.scheduledRecordingAt,
    scheduled_publish_at: parsed.scheduledPublishAt,
    is_daily_recurring: parsed.isDailyRecurring,
    notes: parsed.notes,
    // stage arranca en 'planificado' por default (0159).
  } as never;

  const { data, error } = await supabase
    .from("content_pieces")
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    if (error.code === "23514") {
      return {
        error:
          "El piece rebotó un guard de coherencia. Verificá que el dueño pertenece a tu organización.",
      };
    }
    if (error.code === "23503") {
      return { error: "El dueño elegido no existe. Refrescá la página." };
    }
    return { error: error.message };
  }

  const created = data as { id: string } | null;
  if (!created) return { error: "El insert no devolvió fila." };

  revalidatePath("/marketing/planificacion");
  return { ok: true, pieceId: created.id };
}

// ═══════════════════════════════════════════════════════════════════════════
// updatePiece
//
// NO edita `stage` (eso vive en setStage / triggers). NO edita
// `recording_session_id` (eso lo pobla el bloque Grabación al asociar el
// piece a una sesión). Todo lo demás es libre.
// ═══════════════════════════════════════════════════════════════════════════

export async function updatePiece(
  pieceId: string,
  _prev: UpdatePieceState,
  formData: FormData,
): Promise<UpdatePieceState> {
  if (!pieceId) return { error: "Falta el id del piece." };

  const parsed = parsePieceFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createSupabaseClient();
  const payload = {
    content_owner_id: parsed.contentOwnerId,
    title: parsed.title,
    script_md: parsed.scriptMd,
    category: parsed.category,
    format: parsed.format,
    platforms: parsed.platforms,
    scheduled_recording_at: parsed.scheduledRecordingAt,
    scheduled_publish_at: parsed.scheduledPublishAt,
    is_daily_recurring: parsed.isDailyRecurring,
    notes: parsed.notes,
  } as never;

  const { error } = await supabase
    .from("content_pieces")
    .update(payload)
    .eq("id", pieceId);

  if (error) {
    if (error.code === "23514") {
      return {
        error:
          "El piece rebotó un guard de coherencia. Verificá que el dueño pertenece a tu organización.",
      };
    }
    return { error: error.message };
  }

  revalidatePath("/marketing/planificacion");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// setStage — solo para "descartar" o "restaurar de descartado" desde la UI.
//
// Las demás transiciones las dispara el trigger de 0165 cuando la etapa
// correspondiente se completa (grabación realizada, asset editado, upload
// subido). Un operador NO debería empujar manualmente un piece a
// 'listo_para_subir' si no hay asset editado — sería mentir sobre el estado.
//
// Este action valida stages permitidas y rebota el resto. Extender solo si
// aparece un caso de uso concreto.
// ═══════════════════════════════════════════════════════════════════════════

const MANUALLY_SETTABLE_STAGES: readonly MarketingStage[] = [
  "planificado",
  "descartado",
];

export async function setPieceStage(
  pieceId: string,
  nextStage: string,
): Promise<SetStageResult> {
  if (!pieceId) return { error: "Falta el id del piece." };
  if (!isMarketingStage(nextStage)) return { error: "Stage inválido." };
  if (!MANUALLY_SETTABLE_STAGES.includes(nextStage)) {
    return {
      error:
        "Este stage se mueve automáticamente cuando la etapa correspondiente se completa (grabación, edición, subida). Desde la UI solo se puede marcar como descartado o restaurar a planificado.",
    };
  }

  const supabase = await createSupabaseClient();
  const payload = { stage: nextStage } as never;
  const { error } = await supabase
    .from("content_pieces")
    .update(payload)
    .eq("id", pieceId);
  if (error) return { error: error.message };

  revalidatePath("/marketing/planificacion");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// deletePiece — hard delete acotado a errores de carga.
//
// Solo permitido si stage='planificado' y sin recording_session_id
// (recording_session_id se popula cuando se asocia a una sesión en 0160).
// Cualquier piece que ya haya avanzado tiene historial que se rompería.
// Para pieces avanzadas: usar setPieceStage('descartado') — preserva el
// piece pero lo saca del pipeline.
// ═══════════════════════════════════════════════════════════════════════════

export async function deletePiece(
  pieceId: string,
): Promise<DeletePieceResult> {
  if (!pieceId) return { error: "Falta el id del piece." };

  const supabase = await createSupabaseClient();

  const { data: currentRaw, error: fetchErr } = await supabase
    .from("content_pieces")
    .select("stage, recording_session_id")
    .eq("id", pieceId)
    .single();
  if (fetchErr) return { error: fetchErr.message };

  const current = currentRaw as unknown as
    | { stage: string; recording_session_id: string | null }
    | null;
  if (!current) return { error: "Piece no encontrado." };

  if (current.stage !== "planificado" || current.recording_session_id != null) {
    return {
      error:
        "Solo se pueden eliminar pieces en estado 'planificado' que aún no fueron asignadas a una sesión de grabación. Marcá como 'descartado' en su lugar.",
    };
  }

  const { error } = await supabase
    .from("content_pieces")
    .delete()
    .eq("id", pieceId);
  if (error) return { error: error.message };

  revalidatePath("/marketing/planificacion");
  return { ok: true };
}

// Re-exportar la lista de plataformas por si un cliente lo necesita — evita
// que cada cliente re-importe de types.ts sabiendo que ya vino por acá.
export { MARKETING_PLATFORMS };
