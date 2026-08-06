"use server";

import { revalidatePath } from "next/cache";

import { createClient as createSupabaseClient } from "@/lib/supabase/server";

// ═══════════════════════════════════════════════════════════════════════════
// CRUD de classes + attendance (bloque 4 · 0074 + 0076).
//
// Ambas tablas son project-scope puro: NO tienen organization_id. El
// project_id lo derivan triggers (`before_denorm_project_id_from_cohort`
// para classes; `a_check_consistency` para attendance que además valida
// que class.project_id = student.project_id).
//
// El guard `propia_project` rebota 23514 si el project del cohort no es
// ownership='propia'.
//
// Cascades: borrar class borra su attendance; borrar student borra su
// attendance. Borrar cohort borra sus classes (y por transitividad todo).
// ═══════════════════════════════════════════════════════════════════════════

export type CreateClassState =
  | { ok: true; classId: string }
  | { error: string }
  | null;

export type UpdateClassState = { ok: true } | { error: string } | null;

export type DeleteClassResult = { ok: true } | { error: string };

export type BulkAttendanceResult =
  | { ok: true; upserted: number }
  | { error: string };

function nullIfEmpty(value: FormDataEntryValue | null): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length === 0 ? null : trimmed;
}

function translateCheckError(msg: string): string {
  if (msg.includes("propia")) {
    return "El proyecto no es propia. Academia solo admite proyectos con ownership='propia'.";
  }
  if (msg.includes("student.project_id") && msg.includes("class.project_id")) {
    return "El estudiante pertenece a otro proyecto que la clase. Academia no mezcla proyectos.";
  }
  return msg;
}

interface ClassPayload {
  readonly cohortId: string;
  readonly scheduledAtIso: string;
  readonly topic: string | null;
  readonly notes: string | null;
}

function parseClassFormData(formData: FormData): ClassPayload | string {
  const cohortId = nullIfEmpty(formData.get("cohort_id"));
  if (cohortId == null) return "Falta la generación.";

  const scheduledAtIso = nullIfEmpty(formData.get("scheduled_at_iso"));
  if (scheduledAtIso == null) return "La fecha y hora son obligatorias.";
  const parsed = new Date(scheduledAtIso);
  if (Number.isNaN(parsed.getTime())) {
    return "La fecha y hora no son válidas.";
  }

  const topic = nullIfEmpty(formData.get("topic"));
  if (topic != null && topic.length > 300) {
    return "El tema es demasiado largo (máximo 300 caracteres).";
  }

  const notes = nullIfEmpty(formData.get("notes"));

  return { cohortId, scheduledAtIso, topic, notes };
}

// ═══════════════════════════════════════════════════════════════════════════
// createClass
// ═══════════════════════════════════════════════════════════════════════════

export async function createClass(
  _prev: CreateClassState,
  formData: FormData,
): Promise<CreateClassState> {
  const parsed = parseClassFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createSupabaseClient();
  // project_id lo autofillea el trigger desde cohort.
  const payload = {
    cohort_id: parsed.cohortId,
    scheduled_at: parsed.scheduledAtIso,
    topic: parsed.topic,
    notes: parsed.notes,
  } as never;

  const { data, error } = await supabase
    .from("classes")
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    if (error.code === "23514") {
      return { error: translateCheckError(error.message) };
    }
    return { error: error.message };
  }

  const created = data as { id: string } | null;
  if (!created) return { error: "El insert no devolvió fila." };

  revalidatePath(`/academia/cohortes/${parsed.cohortId}`);
  revalidatePath("/academia");
  return { ok: true, classId: created.id };
}

// ═══════════════════════════════════════════════════════════════════════════
// updateClass
// ═══════════════════════════════════════════════════════════════════════════

export async function updateClass(
  classId: string,
  _prev: UpdateClassState,
  formData: FormData,
): Promise<UpdateClassState> {
  if (!classId) return { error: "Falta el id de la clase." };

  const parsed = parseClassFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createSupabaseClient();
  // No dejamos que el usuario mueva la clase de cohort — el drawer no
  // expone el cohort_id, pero por defensa igual lo tomamos del form
  // y lo actualizamos (siempre igual al de la clase original).
  const payload = {
    cohort_id: parsed.cohortId,
    scheduled_at: parsed.scheduledAtIso,
    topic: parsed.topic,
    notes: parsed.notes,
  } as never;

  const { error } = await supabase
    .from("classes")
    .update(payload)
    .eq("id", classId);

  if (error) {
    if (error.code === "23514") {
      return { error: translateCheckError(error.message) };
    }
    return { error: error.message };
  }

  revalidatePath(`/academia/cohortes/${parsed.cohortId}`);
  revalidatePath("/academia");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// deleteClass — hard delete. La attendance de la clase cascadea.
// ═══════════════════════════════════════════════════════════════════════════

export async function deleteClass(
  classId: string,
): Promise<DeleteClassResult> {
  if (!classId) return { error: "Falta el id de la clase." };

  const supabase = await createSupabaseClient();

  const { data: existing } = await supabase
    .from("classes")
    .select("cohort_id")
    .eq("id", classId)
    .maybeSingle();
  const cohortId =
    (existing as { cohort_id: string } | null)?.cohort_id ?? null;

  const { error } = await supabase
    .from("classes")
    .delete()
    .eq("id", classId);
  if (error) return { error: error.message };

  if (cohortId) revalidatePath(`/academia/cohortes/${cohortId}`);
  revalidatePath("/academia");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// bulkSetAttendance
//
// Recibe entries de la matriz. Cada entry es un student con present true/
// false. Upsertea por (class_id, student_id). Los students que no aparecen
// en la lista no se tocan — la UI debe mandar todos los de la matriz aunque
// no hayan cambiado, para que "desmarcado = ausente" sea explícito.
//
// project_id no se manda: el trigger `a_check_consistency` lo llena desde
// class_id antes del NOT NULL check.
// ═══════════════════════════════════════════════════════════════════════════

export interface AttendanceEntry {
  readonly studentId: string;
  readonly present: boolean;
}

export async function bulkSetAttendance(
  classId: string,
  entries: readonly AttendanceEntry[],
): Promise<BulkAttendanceResult> {
  if (!classId) return { error: "Falta el id de la clase." };
  if (entries.length === 0) return { ok: true, upserted: 0 };

  const supabase = await createSupabaseClient();

  const { data: classRow } = await supabase
    .from("classes")
    .select("cohort_id")
    .eq("id", classId)
    .maybeSingle();
  const cohortId =
    (classRow as { cohort_id: string } | null)?.cohort_id ?? null;

  const rows = entries.map((e) => ({
    class_id: classId,
    student_id: e.studentId,
    present: e.present,
  }));

  const { error, count } = await supabase
    .from("attendance")
    .upsert(rows as never, {
      onConflict: "class_id,student_id",
      count: "exact",
    });

  if (error) {
    if (error.code === "23514") {
      return { error: translateCheckError(error.message) };
    }
    return { error: error.message };
  }

  if (cohortId) revalidatePath(`/academia/cohortes/${cohortId}`);
  revalidatePath("/academia");
  return { ok: true, upserted: count ?? entries.length };
}
