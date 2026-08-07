"use server";

import { revalidatePath } from "next/cache";

import { createClient as createSupabaseClient } from "@/lib/supabase/server";

// ═══════════════════════════════════════════════════════════════════════════
// CRUD de enrollments (bloque 4 · 0075 + puente 0112).
//
// Un enrollment liga student ↔ cohort. project_id se autofillea via
// trigger `a_check_consistency` desde cohort.project_id (que a su vez
// exige que sea igual a student.project_id, sino rebota).
//
// sale_id opcional (0112). Si se setea, el trigger check_sale_product
// valida que la venta apunte al mismo producto que el course de la
// cohort — si no, rebota.
//
// Unique (student_id, cohort_id): un estudiante inscripto una sola vez
// a la misma generación.
// ═══════════════════════════════════════════════════════════════════════════

const STATUSES = ["active", "completed", "dropped", "suspended"] as const;

type Status = (typeof STATUSES)[number];

export type CreateEnrollmentState =
  | { ok: true; enrollmentId: string }
  | { error: string }
  | null;

export type UpdateEnrollmentState = { ok: true } | { error: string } | null;

export type DeleteEnrollmentResult = { ok: true } | { error: string };

export interface BulkEnrollFailure {
  readonly studentId: string;
  readonly error: string;
}

export type BulkEnrollResult = {
  ok: true;
  enrolledCount: number;
  failures: readonly BulkEnrollFailure[];
};

const YMD_RX = /^\d{4}-\d{2}-\d{2}$/;

function nullIfEmpty(value: FormDataEntryValue | null): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length === 0 ? null : trimmed;
}

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

interface EnrollmentPayload {
  readonly studentId: string;
  readonly cohortId: string;
  readonly saleId: string | null;
  readonly enrolledAt: string;
  readonly status: Status;
  readonly progressPercent: number;
  readonly notes: string | null;
}

function parseEnrollmentFormData(
  formData: FormData,
): EnrollmentPayload | string {
  const studentId = nullIfEmpty(formData.get("student_id"));
  if (studentId == null) return "Elegí un estudiante.";

  const cohortId = nullIfEmpty(formData.get("cohort_id"));
  if (cohortId == null) return "Falta la generación.";

  const saleId = nullIfEmpty(formData.get("sale_id"));

  const enrolledAtRaw = nullIfEmpty(formData.get("enrolled_at"));
  const enrolledAt = enrolledAtRaw ?? todayYmd();
  if (!YMD_RX.test(enrolledAt)) return "La fecha de inscripción no es válida.";

  const statusRaw = String(formData.get("status") ?? "active").trim();
  if (!(STATUSES as readonly string[]).includes(statusRaw)) {
    return "Estado inválido.";
  }
  const status = statusRaw as Status;

  const progressRaw = String(formData.get("progress_percent") ?? "0").trim();
  const progress = Number(progressRaw);
  if (!Number.isFinite(progress) || progress < 0 || progress > 100) {
    return "Progreso tiene que ser un número entre 0 y 100.";
  }
  const progressPercent = Math.round(progress);

  const notes = nullIfEmpty(formData.get("notes"));

  return {
    studentId,
    cohortId,
    saleId,
    enrolledAt,
    status,
    progressPercent,
    notes,
  };
}

function translateCheckError(msg: string): string {
  if (msg.includes("propia")) {
    return "El proyecto no es propia. Academia solo admite proyectos con ownership='propia'.";
  }
  if (msg.includes("student") && msg.includes("cohort")) {
    return "El estudiante pertenece a otro proyecto que la generación. Elegí student y generación del mismo proyecto propio.";
  }
  if (msg.includes("cohort no tiene un curso asociado")) {
    return "No se puede vincular una venta a una generación sin curso. Asignale un curso a la generación primero, o dejá el enrollment sin venta.";
  }
  if (msg.includes("producto")) {
    return "La venta seleccionada es de un producto distinto al del curso de la generación. Elegí una venta del mismo producto o dejala sin venta.";
  }
  return msg;
}

// ═══════════════════════════════════════════════════════════════════════════
// createEnrollment
// ═══════════════════════════════════════════════════════════════════════════

export async function createEnrollment(
  _prev: CreateEnrollmentState,
  formData: FormData,
): Promise<CreateEnrollmentState> {
  const parsed = parseEnrollmentFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createSupabaseClient();
  // project_id se autofillea via trigger desde cohorts.
  const payload = {
    student_id: parsed.studentId,
    cohort_id: parsed.cohortId,
    sale_id: parsed.saleId,
    enrolled_at: parsed.enrolledAt,
    status: parsed.status,
    progress_percent: parsed.progressPercent,
    notes: parsed.notes,
  } as never;

  const { data, error } = await supabase
    .from("enrollments")
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return {
        error: "Este estudiante ya está inscripto en la generación.",
      };
    }
    if (error.code === "23514") {
      return { error: translateCheckError(error.message) };
    }
    return { error: error.message };
  }

  const created = data as { id: string } | null;
  if (!created) return { error: "El insert no devolvió fila." };

  revalidatePath(`/academia/cohortes/${parsed.cohortId}`);
  revalidatePath(`/academia/estudiantes/${parsed.studentId}`);
  revalidatePath("/academia/cohortes");
  revalidatePath("/academia/estudiantes");
  revalidatePath("/academia");
  return { ok: true, enrollmentId: created.id };
}

// ═══════════════════════════════════════════════════════════════════════════
// updateEnrollment
// ═══════════════════════════════════════════════════════════════════════════

export async function updateEnrollment(
  enrollmentId: string,
  _prev: UpdateEnrollmentState,
  formData: FormData,
): Promise<UpdateEnrollmentState> {
  if (!enrollmentId) return { error: "Falta el id de la inscripción." };

  const parsed = parseEnrollmentFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createSupabaseClient();
  const payload = {
    student_id: parsed.studentId,
    cohort_id: parsed.cohortId,
    sale_id: parsed.saleId,
    enrolled_at: parsed.enrolledAt,
    status: parsed.status,
    progress_percent: parsed.progressPercent,
    notes: parsed.notes,
  } as never;

  const { error } = await supabase
    .from("enrollments")
    .update(payload)
    .eq("id", enrollmentId);

  if (error) {
    if (error.code === "23505") {
      return {
        error: "El estudiante ya está inscripto en esa generación.",
      };
    }
    if (error.code === "23514") {
      return { error: translateCheckError(error.message) };
    }
    return { error: error.message };
  }

  revalidatePath(`/academia/cohortes/${parsed.cohortId}`);
  revalidatePath(`/academia/estudiantes/${parsed.studentId}`);
  revalidatePath("/academia/cohortes");
  revalidatePath("/academia/estudiantes");
  revalidatePath("/academia");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// bulkEnrollStudents
//
// Inscribe N students en una cohort en un solo llamado. sale_id=null en
// todos (badge "Manual" en el listado). Los errores por student (unique
// por ya-inscripto, o guard por proyecto mismatch) se agregan en
// `failures`. Los que fallan no rompen el batch.
// ═══════════════════════════════════════════════════════════════════════════

export async function bulkEnrollStudents(
  cohortId: string,
  studentIds: readonly string[],
): Promise<BulkEnrollResult | { error: string }> {
  if (!cohortId) return { error: "Falta el id de la generación." };
  if (studentIds.length === 0) {
    return { ok: true, enrolledCount: 0, failures: [] };
  }

  const supabase = await createSupabaseClient();

  const failures: BulkEnrollFailure[] = [];
  let enrolledCount = 0;

  for (const studentId of studentIds) {
    const payload = {
      student_id: studentId,
      cohort_id: cohortId,
      sale_id: null,
      enrolled_at: todayYmd(),
      status: "active",
      progress_percent: 0,
      notes: null,
    } as never;

    const { error } = await supabase.from("enrollments").insert(payload);

    if (error) {
      let message = error.message;
      if (error.code === "23505") {
        message = "Ya estaba inscripto en esta generación.";
      } else if (error.code === "23514") {
        message = translateCheckError(error.message);
      }
      failures.push({ studentId, error: message });
      continue;
    }
    enrolledCount++;
  }

  revalidatePath(`/academia/cohortes/${cohortId}`);
  revalidatePath("/academia/cohortes");
  revalidatePath("/academia/estudiantes");
  revalidatePath("/academia");

  return { ok: true, enrolledCount, failures };
}

// ═══════════════════════════════════════════════════════════════════════════
// deleteEnrollment — hard delete
//
// Los enrollments no tienen dependientes obligatorios (attendance y
// exams referencian student + cohort/class, no enrollment). Se puede
// borrar sin cascada.
// ═══════════════════════════════════════════════════════════════════════════

export async function deleteEnrollment(
  enrollmentId: string,
): Promise<DeleteEnrollmentResult> {
  if (!enrollmentId) return { error: "Falta el id de la inscripción." };

  const supabase = await createSupabaseClient();

  const { data: existing } = await supabase
    .from("enrollments")
    .select("student_id, cohort_id")
    .eq("id", enrollmentId)
    .maybeSingle();
  const prev = existing as
    | { student_id: string; cohort_id: string }
    | null;

  const { error } = await supabase
    .from("enrollments")
    .delete()
    .eq("id", enrollmentId);
  if (error) return { error: error.message };

  if (prev?.cohort_id)
    revalidatePath(`/academia/cohortes/${prev.cohort_id}`);
  if (prev?.student_id)
    revalidatePath(`/academia/estudiantes/${prev.student_id}`);
  revalidatePath("/academia/cohortes");
  revalidatePath("/academia/estudiantes");
  revalidatePath("/academia");
  return { ok: true };
}
