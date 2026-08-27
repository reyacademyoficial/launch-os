"use server";

import { revalidatePath } from "next/cache";

import { createClient as createSupabaseClient } from "@/lib/supabase/server";

// NOTA: cohorts NO se cachea (varía por generación y tiene enrollments/
// classes/exams que cambian seguido). Los tags de referencia (courses,
// projects, systems) no se rompen desde acá — se rompen desde sus
// respectivos actions.

// ═══════════════════════════════════════════════════════════════════════════
// CRUD de cohorts (bloque 4 · 0073).
//
// project_id requerido (guard_propia_project rebota si el project no es
// propia). course_id opcional. Si course_id seteado, el trigger
// check_course_project valida que course.project_id = cohort.project_id.
//
// Unique (project_id, name). CHECK end_date >= start_date.
//
// Delete es hard con guard duro: bloquea si tiene enrollments/classes/
// exams. No hay soft-delete via status — los estados 'finished' y
// 'cancelled' son estados terminales normales, no equivalen a "borrado".
// ═══════════════════════════════════════════════════════════════════════════

const STATUSES = ["planned", "active", "finished", "cancelled"] as const;

type Status = (typeof STATUSES)[number];

export type CreateCohortState =
  | { ok: true; cohortId: string }
  | { error: string }
  | null;

export type UpdateCohortState = { ok: true } | { error: string } | null;

export type DeleteCohortResult = { ok: true } | { error: string };

const YMD_RX = /^\d{4}-\d{2}-\d{2}$/;

function nullIfEmpty(value: FormDataEntryValue | null): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length === 0 ? null : trimmed;
}

interface CohortPayload {
  readonly projectId: string;
  readonly courseId: string | null;
  readonly systemId: string | null;
  readonly name: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly status: Status;
  readonly notes: string | null;
}

function parseCohortFormData(formData: FormData): CohortPayload | string {
  const projectId = nullIfEmpty(formData.get("project_id"));
  if (projectId == null) return "Elegí un proyecto.";

  const courseId = nullIfEmpty(formData.get("course_id"));
  const systemId = nullIfEmpty(formData.get("system_id"));

  if (systemId != null && courseId == null) {
    return "No se puede asignar un sistema si la cohorte no tiene curso.";
  }

  const name = String(formData.get("name") ?? "").trim();
  if (name.length === 0) return "El nombre es obligatorio.";
  if (name.length > 200)
    return "El nombre es demasiado largo (máximo 200 caracteres).";

  const startDate = nullIfEmpty(formData.get("start_date"));
  const endDate = nullIfEmpty(formData.get("end_date"));
  if (startDate == null || !YMD_RX.test(startDate)) {
    return "La fecha de inicio es obligatoria.";
  }
  if (endDate == null || !YMD_RX.test(endDate)) {
    return "La fecha de fin es obligatoria.";
  }
  if (endDate < startDate) {
    return "La fecha de fin no puede ser anterior al inicio.";
  }

  const statusRaw = String(formData.get("status") ?? "").trim();
  if (!(STATUSES as readonly string[]).includes(statusRaw)) {
    return "Estado inválido.";
  }
  const status = statusRaw as Status;

  const notes = nullIfEmpty(formData.get("notes"));

  return {
    projectId,
    courseId,
    systemId,
    name,
    startDate,
    endDate,
    status,
    notes,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// createCohort
// ═══════════════════════════════════════════════════════════════════════════

export async function createCohort(
  _prev: CreateCohortState,
  formData: FormData,
): Promise<CreateCohortState> {
  const parsed = parseCohortFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createSupabaseClient();
  const payload = {
    project_id: parsed.projectId,
    course_id: parsed.courseId,
    system_id: parsed.systemId,
    name: parsed.name,
    start_date: parsed.startDate,
    end_date: parsed.endDate,
    status: parsed.status,
    notes: parsed.notes,
  } as never;

  const { data, error } = await supabase
    .from("cohorts")
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return {
        error: "Ya existe una generación con ese nombre en el proyecto.",
      };
    }
    if (error.code === "23514") {
      return {
        error: translateCheckError(error.message),
      };
    }
    return { error: error.message };
  }

  const created = data as { id: string } | null;
  if (!created) return { error: "El insert no devolvió fila." };

  revalidatePath("/academia/cohortes");
  revalidatePath("/academia");
  return { ok: true, cohortId: created.id };
}

// ═══════════════════════════════════════════════════════════════════════════
// updateCohort
// ═══════════════════════════════════════════════════════════════════════════

export async function updateCohort(
  cohortId: string,
  _prev: UpdateCohortState,
  formData: FormData,
): Promise<UpdateCohortState> {
  if (!cohortId) return { error: "Falta el id de la generación." };

  const parsed = parseCohortFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createSupabaseClient();
  const payload = {
    project_id: parsed.projectId,
    course_id: parsed.courseId,
    system_id: parsed.systemId,
    name: parsed.name,
    start_date: parsed.startDate,
    end_date: parsed.endDate,
    status: parsed.status,
    notes: parsed.notes,
  } as never;

  const { error } = await supabase
    .from("cohorts")
    .update(payload)
    .eq("id", cohortId);

  if (error) {
    if (error.code === "23505") {
      return {
        error: "Ya existe otra generación con ese nombre en el proyecto.",
      };
    }
    if (error.code === "23514") {
      return { error: translateCheckError(error.message) };
    }
    return { error: error.message };
  }

  revalidatePath("/academia/cohortes");
  revalidatePath(`/academia/cohortes/${cohortId}`);
  revalidatePath("/academia");
  return { ok: true };
}

function translateCheckError(msg: string): string {
  if (msg.includes("propia")) {
    return "El proyecto no es propia. Academia solo admite proyectos con ownership='propia'.";
  }
  if (msg.includes("course") && msg.includes("project")) {
    return "El curso pertenece a otro proyecto. Elegí un curso del mismo proyecto de la generación.";
  }
  return msg;
}

// ═══════════════════════════════════════════════════════════════════════════
// deleteCohort — hard delete con guard duro
//
// Bloquea si tiene enrollments, classes o exams. Cerrar la cohorte
// (status='finished' o 'cancelled') es la ruta normal para "terminar" —
// preserva historial.
// ═══════════════════════════════════════════════════════════════════════════

export async function deleteCohort(
  cohortId: string,
): Promise<DeleteCohortResult> {
  if (!cohortId) return { error: "Falta el id de la generación." };

  const supabase = await createSupabaseClient();

  const [enrollmentsRes, classesRes, examsRes] = await Promise.all([
    supabase
      .from("enrollments")
      .select("id", { count: "exact", head: true })
      .eq("cohort_id", cohortId),
    supabase
      .from("classes")
      .select("id", { count: "exact", head: true })
      .eq("cohort_id", cohortId),
    supabase
      .from("exams")
      .select("id", { count: "exact", head: true })
      .eq("cohort_id", cohortId),
  ]);

  const deps: string[] = [];
  const enrollmentsCount = enrollmentsRes.count ?? 0;
  const classesCount = classesRes.count ?? 0;
  const examsCount = examsRes.count ?? 0;

  if (enrollmentsCount > 0) {
    deps.push(
      `${enrollmentsCount} inscripción${enrollmentsCount === 1 ? "" : "es"}`,
    );
  }
  if (classesCount > 0) {
    deps.push(`${classesCount} clase${classesCount === 1 ? "" : "s"}`);
  }
  if (examsCount > 0) {
    deps.push(`${examsCount} examen${examsCount === 1 ? "" : "es"}`);
  }

  if (deps.length > 0) {
    return {
      error:
        `No se puede eliminar: la generación tiene ${deps.join(", ")}. ` +
        "Cerrala (status='Terminada' o 'Cancelada') para preservar el historial.",
    };
  }

  const { error } = await supabase.from("cohorts").delete().eq("id", cohortId);
  if (error) return { error: error.message };

  revalidatePath("/academia/cohortes");
  revalidatePath("/academia");
  return { ok: true };
}
