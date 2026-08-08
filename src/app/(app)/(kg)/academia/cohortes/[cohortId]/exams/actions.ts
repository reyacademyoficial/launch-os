"use server";

import { revalidatePath } from "next/cache";

import { createClient as createSupabaseClient } from "@/lib/supabase/server";

// ═══════════════════════════════════════════════════════════════════════════
// CRUD de exams (bloque 4 · 0077).
//
// score nullable (pendiente de corrección). passed nullable independiente
// del score — el operador puede setear score=85 y aún no decidir passed,
// o marcar aprobado sin score (rescate manual).
//
// project_id lo autofillea el trigger `a_check_consistency` desde
// cohort.project_id (validando que sea igual a student.project_id, sino
// rebota 23514). guard_propia_project rebota si el project no es propia.
//
// Sin organization_id — project-scope puro.
// ═══════════════════════════════════════════════════════════════════════════

export type CreateExamState =
  | { ok: true; examId: string }
  | { error: string }
  | null;

export type UpdateExamState = { ok: true } | { error: string } | null;

export type DeleteExamResult = { ok: true } | { error: string };

const YMD_RX = /^\d{4}-\d{2}-\d{2}$/;

// El radio en la UI produce uno de estos valores; los mapeamos a passed.
const PASSED_STATES = ["pending", "passed", "failed"] as const;
type PassedState = (typeof PASSED_STATES)[number];

function nullIfEmpty(value: FormDataEntryValue | null): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length === 0 ? null : trimmed;
}

function translateCheckError(msg: string): string {
  if (msg.includes("propia")) {
    return "El proyecto no es propia. Academia solo admite proyectos con ownership='propia'.";
  }
  if (
    msg.includes("student.project_id") &&
    msg.includes("cohort.project_id")
  ) {
    return "El estudiante pertenece a otro proyecto que la generación. Elegí student de la misma generación.";
  }
  if (msg.includes("score")) {
    return "La nota tiene que estar entre 0 y 100.";
  }
  return msg;
}

interface ExamPayload {
  readonly studentId: string;
  readonly cohortId: string;
  readonly title: string;
  readonly score: number | null;
  readonly passed: boolean | null;
  readonly takenAt: string;
  readonly notes: string | null;
}

function parseExamFormData(formData: FormData): ExamPayload | string {
  const studentId = nullIfEmpty(formData.get("student_id"));
  if (studentId == null) return "Elegí un estudiante.";

  const cohortId = nullIfEmpty(formData.get("cohort_id"));
  if (cohortId == null) return "Falta la generación.";

  const title = String(formData.get("title") ?? "").trim();
  if (title.length === 0) return "El título es obligatorio.";
  if (title.length > 200)
    return "El título es demasiado largo (máximo 200 caracteres).";

  const takenAt = nullIfEmpty(formData.get("taken_at"));
  if (takenAt == null || !YMD_RX.test(takenAt)) {
    return "La fecha del examen es obligatoria.";
  }

  const scoreRaw = nullIfEmpty(formData.get("score"));
  let score: number | null;
  if (scoreRaw == null) {
    score = null;
  } else {
    const n = Number(scoreRaw);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      return "La nota tiene que ser un número entre 0 y 100.";
    }
    score = Math.round(n * 100) / 100;
  }

  const passedRaw = String(formData.get("passed_state") ?? "pending").trim();
  if (!(PASSED_STATES as readonly string[]).includes(passedRaw)) {
    return "Estado inválido.";
  }
  const passedState = passedRaw as PassedState;
  const passed =
    passedState === "pending"
      ? null
      : passedState === "passed"
        ? true
        : false;

  const notes = nullIfEmpty(formData.get("notes"));

  return {
    studentId,
    cohortId,
    title,
    score,
    passed,
    takenAt,
    notes,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// createExam
// ═══════════════════════════════════════════════════════════════════════════

export async function createExam(
  _prev: CreateExamState,
  formData: FormData,
): Promise<CreateExamState> {
  const parsed = parseExamFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createSupabaseClient();
  const payload = {
    student_id: parsed.studentId,
    cohort_id: parsed.cohortId,
    title: parsed.title,
    score: parsed.score,
    passed: parsed.passed,
    taken_at: parsed.takenAt,
    notes: parsed.notes,
  } as never;

  const { data, error } = await supabase
    .from("exams")
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
  revalidatePath(`/academia/estudiantes/${parsed.studentId}`);
  revalidatePath("/academia");
  return { ok: true, examId: created.id };
}

// ═══════════════════════════════════════════════════════════════════════════
// updateExam
// ═══════════════════════════════════════════════════════════════════════════

export async function updateExam(
  examId: string,
  _prev: UpdateExamState,
  formData: FormData,
): Promise<UpdateExamState> {
  if (!examId) return { error: "Falta el id del examen." };

  const parsed = parseExamFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createSupabaseClient();
  const payload = {
    student_id: parsed.studentId,
    cohort_id: parsed.cohortId,
    title: parsed.title,
    score: parsed.score,
    passed: parsed.passed,
    taken_at: parsed.takenAt,
    notes: parsed.notes,
  } as never;

  const { error } = await supabase
    .from("exams")
    .update(payload)
    .eq("id", examId);

  if (error) {
    if (error.code === "23514") {
      return { error: translateCheckError(error.message) };
    }
    return { error: error.message };
  }

  revalidatePath(`/academia/cohortes/${parsed.cohortId}`);
  revalidatePath(`/academia/estudiantes/${parsed.studentId}`);
  revalidatePath("/academia");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// deleteExam — hard delete. Un examen borrado no deja rastro; si hace
// falta preservar historial, editarlo y anotar en notes es la ruta.
// ═══════════════════════════════════════════════════════════════════════════

export async function deleteExam(examId: string): Promise<DeleteExamResult> {
  if (!examId) return { error: "Falta el id del examen." };

  const supabase = await createSupabaseClient();

  const { data: existing } = await supabase
    .from("exams")
    .select("cohort_id, student_id")
    .eq("id", examId)
    .maybeSingle();
  const prev = existing as
    | { cohort_id: string; student_id: string }
    | null;

  const { error } = await supabase.from("exams").delete().eq("id", examId);
  if (error) return { error: error.message };

  if (prev?.cohort_id)
    revalidatePath(`/academia/cohortes/${prev.cohort_id}`);
  if (prev?.student_id)
    revalidatePath(`/academia/estudiantes/${prev.student_id}`);
  revalidatePath("/academia");
  return { ok: true };
}
