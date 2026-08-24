"use server";

import { revalidatePath } from "next/cache";

import { resolveCurrentOrganizationId } from "@/lib/organization/current";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import {
  isRecordingRole,
  isRecordingSessionStatus,
  type RecordingRole,
  type RecordingSessionStatus,
} from "@/lib/marketing/types";

// ═══════════════════════════════════════════════════════════════════════════
// CRUD de recording_sessions (0160) + junction recording_assignees (0161)
// + toggle de content_pieces.recording_session_id.
//
// Un submit del drawer sincroniza las 3 cosas: crea/edita la session,
// reemplaza el set completo de assignees, y sincroniza el set de pieces
// asociadas. Sin transacción explícita: postgrest no expone BEGIN/COMMIT
// desde el server client; el orden minimiza el daño si algo falla en el
// medio (session primero, luego assignees, luego pieces).
//
// setSessionStatus dispara el trigger 0160 que avanza pieces asociadas
// (planificado|en_grabacion → en_edicion) cuando pasa a 'realizada'.
// ═══════════════════════════════════════════════════════════════════════════

export type CreateSessionState =
  | { ok: true; sessionId: string }
  | { error: string }
  | null;

export type UpdateSessionState = { ok: true } | { error: string } | null;

export type SetStatusResult = { ok: true } | { error: string };

export type DeleteSessionResult = { ok: true } | { error: string };

function nullIfEmpty(value: FormDataEntryValue | null): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length === 0 ? null : trimmed;
}

interface AssigneeInput {
  readonly personId: string;
  readonly role: RecordingRole;
}

interface SessionPayload {
  readonly contentOwnerId: string;
  readonly scheduledAt: string;
  readonly durationMinutes: number | null;
  readonly location: string | null;
  readonly materials: string | null;
  readonly notes: string | null;
  readonly assignees: readonly AssigneeInput[];
  readonly pieceIds: readonly string[];
}

/**
 * Parsea el form del drawer. `assignees` viaja como filas repetidas:
 * `assignee_person_id[]` + `assignee_role[]` en paralelo (mismo índice).
 * `piece_ids[]` es un array simple de uuids seleccionados.
 */
function parseSessionFormData(formData: FormData): SessionPayload | string {
  const contentOwnerId = String(formData.get("content_owner_id") ?? "").trim();
  if (contentOwnerId.length === 0) return "Elegí un dueño de contenido.";

  const scheduledAt = String(formData.get("scheduled_at") ?? "").trim();
  if (scheduledAt.length === 0) return "La fecha y hora de grabación es obligatoria.";

  const durationRaw = String(formData.get("duration_minutes") ?? "").trim();
  let durationMinutes: number | null = null;
  if (durationRaw.length > 0) {
    const n = Number.parseInt(durationRaw, 10);
    if (!Number.isFinite(n) || n <= 0) {
      return "La duración estimada debe ser un entero positivo (minutos).";
    }
    durationMinutes = n;
  }

  const location = nullIfEmpty(formData.get("location"));
  const materials = nullIfEmpty(formData.get("materials"));
  const notes = nullIfEmpty(formData.get("notes"));

  const personIds = formData.getAll("assignee_person_id").map((v) => String(v));
  const roles = formData.getAll("assignee_role").map((v) => String(v));
  if (personIds.length !== roles.length) {
    return "Assignees inconsistentes — refrescá la página y reintentá.";
  }
  const assignees: AssigneeInput[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < personIds.length; i++) {
    const personId = (personIds[i] ?? "").trim();
    const role = (roles[i] ?? "").trim();
    if (personId.length === 0 || role.length === 0) continue;
    if (!isRecordingRole(role)) return "Rol de assignee inválido.";
    const key = `${personId}::${role}`;
    if (seen.has(key)) continue; // dedupe defensivo (PK 0161 lo rebotaría)
    seen.add(key);
    assignees.push({ personId, role });
  }

  const pieceIds = formData
    .getAll("piece_ids")
    .map((v) => String(v).trim())
    .filter((v) => v.length > 0);

  return {
    contentOwnerId,
    scheduledAt,
    durationMinutes,
    location,
    materials,
    notes,
    assignees,
    pieceIds,
  };
}

/**
 * Sincroniza el set de assignees de una session: borra los que ya no están
 * y agrega los nuevos. No usa upsert porque la PK incluye role y necesitamos
 * poder "cambiar el rol de una persona" (que en realidad es delete + insert).
 */
async function syncAssignees(
  supabase: Awaited<ReturnType<typeof createSupabaseClient>>,
  sessionId: string,
  organizationId: string,
  next: readonly AssigneeInput[],
): Promise<string | null> {
  const { data: currentRaw, error: fetchErr } = await supabase
    .from("recording_assignees")
    .select("person_id, role")
    .eq("recording_session_id", sessionId);
  if (fetchErr) return fetchErr.message;

  const current = (currentRaw ?? []) as unknown as ReadonlyArray<{
    readonly person_id: string;
    readonly role: string;
  }>;

  const key = (personId: string, role: string) => `${personId}::${role}`;
  const nextKeys = new Set(next.map((a) => key(a.personId, a.role)));
  const currentKeys = new Set(current.map((a) => key(a.person_id, a.role)));

  const toDelete = current.filter((a) => !nextKeys.has(key(a.person_id, a.role)));
  const toInsert = next.filter((a) => !currentKeys.has(key(a.personId, a.role)));

  // ─── Deletes en paralelo (queries independientes por PK compuesta).
  for (const a of toDelete) {
    const { error } = await supabase
      .from("recording_assignees")
      .delete()
      .eq("recording_session_id", sessionId)
      .eq("person_id", a.person_id)
      .eq("role", a.role);
    if (error) return error.message;
  }

  // ─── Inserts en batch.
  if (toInsert.length > 0) {
    const payload = toInsert.map((a) => ({
      recording_session_id: sessionId,
      person_id: a.personId,
      role: a.role,
      organization_id: organizationId,
    })) as never;
    const { error } = await supabase.from("recording_assignees").insert(payload);
    if (error) return error.message;
  }

  return null;
}

/**
 * Sincroniza el set de pieces asociadas: pieces que estaban en la session
 * y ya no aparecen → recording_session_id = null. Pieces nuevas → recording_
 * session_id = sessionId. El trigger 0160 mueve stage='planificado' a
 * 'en_grabacion' automáticamente en el INSERT del link.
 *
 * NOTA: solo se pueden asociar pieces del mismo owner (validación en la
 * UI + server). Un mismatch cross-owner no rompe la DB pero es semántico:
 * una session pertenece a un solo owner.
 */
async function syncPieces(
  supabase: Awaited<ReturnType<typeof createSupabaseClient>>,
  sessionId: string,
  contentOwnerId: string,
  nextPieceIds: readonly string[],
): Promise<string | null> {
  // Pieces actualmente asociadas.
  const { data: currentRaw, error: fetchErr } = await supabase
    .from("content_pieces")
    .select("id, content_owner_id")
    .eq("recording_session_id", sessionId);
  if (fetchErr) return fetchErr.message;

  const current = (currentRaw ?? []) as unknown as ReadonlyArray<{
    readonly id: string;
    readonly content_owner_id: string;
  }>;

  const currentIds = new Set(current.map((p) => p.id));
  const nextIds = new Set(nextPieceIds);

  const toDetach = current.filter((p) => !nextIds.has(p.id)).map((p) => p.id);
  const toAttach = nextPieceIds.filter((id) => !currentIds.has(id));

  // Detach: nulificar recording_session_id.
  if (toDetach.length > 0) {
    const payload = { recording_session_id: null } as never;
    const { error } = await supabase
      .from("content_pieces")
      .update(payload)
      .in("id", toDetach);
    if (error) return error.message;
  }

  // Attach: setear recording_session_id — pero solo si el owner matchea.
  if (toAttach.length > 0) {
    // Verificar que las pieces pertenecen al mismo owner y están libres.
    const { data: candidatesRaw, error: candidatesErr } = await supabase
      .from("content_pieces")
      .select("id, content_owner_id, recording_session_id")
      .in("id", toAttach);
    if (candidatesErr) return candidatesErr.message;
    const candidates = (candidatesRaw ?? []) as unknown as ReadonlyArray<{
      readonly id: string;
      readonly content_owner_id: string;
      readonly recording_session_id: string | null;
    }>;

    for (const c of candidates) {
      if (c.content_owner_id !== contentOwnerId) {
        return `El piece ${c.id.slice(0, 8)} pertenece a otro dueño y no puede asociarse a esta sesión.`;
      }
      if (
        c.recording_session_id != null &&
        c.recording_session_id !== sessionId
      ) {
        return `El piece ${c.id.slice(0, 8)} ya está asociado a otra sesión. Desatalo primero.`;
      }
    }

    const payload = { recording_session_id: sessionId } as never;
    const { error } = await supabase
      .from("content_pieces")
      .update(payload)
      .in("id", toAttach);
    if (error) return error.message;
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// createSession
// ═══════════════════════════════════════════════════════════════════════════

export async function createSession(
  _prev: CreateSessionState,
  formData: FormData,
): Promise<CreateSessionState> {
  const parsed = parseSessionFormData(formData);
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
    scheduled_at: parsed.scheduledAt,
    duration_minutes: parsed.durationMinutes,
    location: parsed.location,
    materials: parsed.materials,
    notes: parsed.notes,
    // status default 'planificada' desde 0160
  } as never;

  const { data, error } = await supabase
    .from("recording_sessions")
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    if (error.code === "23514") {
      return {
        error:
          "La sesión rebotó un guard de coherencia. Verificá que el dueño pertenece a tu organización.",
      };
    }
    return { error: error.message };
  }

  const created = data as { id: string } | null;
  if (!created) return { error: "El insert no devolvió fila." };

  // Assignees + pieces. Si algo falla acá, la session existe sin ellos —
  // el usuario ve el error y puede reeditar.
  const assigneesErr = await syncAssignees(
    supabase,
    created.id,
    organizationId,
    parsed.assignees,
  );
  if (assigneesErr) return { error: `Sesión creada, pero: ${assigneesErr}` };

  const piecesErr = await syncPieces(
    supabase,
    created.id,
    parsed.contentOwnerId,
    parsed.pieceIds,
  );
  if (piecesErr) return { error: `Sesión creada, pero: ${piecesErr}` };

  revalidatePath("/marketing/grabacion");
  revalidatePath("/marketing/planificacion");
  return { ok: true, sessionId: created.id };
}

// ═══════════════════════════════════════════════════════════════════════════
// updateSession
// ═══════════════════════════════════════════════════════════════════════════

export async function updateSession(
  sessionId: string,
  _prev: UpdateSessionState,
  formData: FormData,
): Promise<UpdateSessionState> {
  if (!sessionId) return { error: "Falta el id de la sesión." };

  const parsed = parseSessionFormData(formData);
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
    scheduled_at: parsed.scheduledAt,
    duration_minutes: parsed.durationMinutes,
    location: parsed.location,
    materials: parsed.materials,
    notes: parsed.notes,
  } as never;

  const { error } = await supabase
    .from("recording_sessions")
    .update(payload)
    .eq("id", sessionId);

  if (error) {
    if (error.code === "23514") {
      return {
        error:
          "La sesión rebotó un guard de coherencia. Verificá que el dueño pertenece a tu organización.",
      };
    }
    return { error: error.message };
  }

  const assigneesErr = await syncAssignees(
    supabase,
    sessionId,
    organizationId,
    parsed.assignees,
  );
  if (assigneesErr) return { error: assigneesErr };

  const piecesErr = await syncPieces(
    supabase,
    sessionId,
    parsed.contentOwnerId,
    parsed.pieceIds,
  );
  if (piecesErr) return { error: piecesErr };

  revalidatePath("/marketing/grabacion");
  revalidatePath("/marketing/planificacion");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// setSessionStatus — cambia el status y dispara triggers de 0160.
//
// Pasar a 'realizada' hace que el trigger content_piece_stage_from_session_
// status avance las pieces asociadas (planificado|en_grabacion → en_edicion).
// Pasar a 'cancelada' NO retrocede las pieces — si ya se grabó y después
// se decide cancelar la sesión, el material queda para editar.
// ═══════════════════════════════════════════════════════════════════════════

export async function setSessionStatus(
  sessionId: string,
  nextStatus: string,
): Promise<SetStatusResult> {
  if (!sessionId) return { error: "Falta el id de la sesión." };
  if (!isRecordingSessionStatus(nextStatus)) {
    return { error: "Status inválido." };
  }

  const supabase = await createSupabaseClient();
  const payload = { status: nextStatus } as never;
  const { error } = await supabase
    .from("recording_sessions")
    .update(payload)
    .eq("id", sessionId);
  if (error) return { error: error.message };

  revalidatePath("/marketing/grabacion");
  revalidatePath("/marketing/planificacion");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// deleteSession — hard delete.
//
// La FK 0160 con `on delete set null` sobre content_pieces preserva las
// pieces (desatándolas). Los assignees se van en cascada por su FK. Sin
// guard extra — borrar una sesión es reversible en la práctica (se recrea
// con los mismos datos si hace falta) y la traza en pieces queda como
// stage='en_edicion' o donde haya llegado.
//
// Si a futuro se agregan assets con FK a session_id, agregar guard.
// ═══════════════════════════════════════════════════════════════════════════

export async function deleteSession(
  sessionId: string,
): Promise<DeleteSessionResult> {
  if (!sessionId) return { error: "Falta el id de la sesión." };

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("recording_sessions")
    .delete()
    .eq("id", sessionId);
  if (error) return { error: error.message };

  revalidatePath("/marketing/grabacion");
  revalidatePath("/marketing/planificacion");
  return { ok: true };
}

// Re-export para clientes.
export type { RecordingRole, RecordingSessionStatus };
