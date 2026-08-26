"use server";

import { revalidatePath } from "next/cache";

import { resolveAccessExpiryForEnrollment } from "@/lib/academia/access-expiration-server";
import {
  parseStudentsWorkbook,
  type ProductForImport,
  type StudentImportRow,
} from "@/lib/academia/xlsx-import";
import { normalizeName, type ParseError } from "@/lib/finance/xlsx-import";
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

const STATUSES = [
  "active",
  "completed",
  "dropped",
  "suspended",
  "expired",
] as const;

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
  /**
   * null = el operador dejó el campo vacío. En create se resuelve con la
   * regla auto (método de pago + override del curso). En update se persiste
   * como null (sin vencimiento).
   */
  readonly accessExpiresAt: string | null;
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

  const accessExpiresAtRaw = nullIfEmpty(formData.get("access_expires_at"));
  if (accessExpiresAtRaw != null && !YMD_RX.test(accessExpiresAtRaw)) {
    return "La fecha de vigencia no es válida.";
  }
  const accessExpiresAt = accessExpiresAtRaw;

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
    accessExpiresAt,
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

  // Resolvemos vigencia + sale_id automáticamente si el operador no los
  // pasó explícitos. Regla: courses.default_access_days (override) o si no
  // hay override, según el método de pago de la venta más reciente del
  // student para el producto del curso.
  const resolved = await resolveAccessExpiryForEnrollment({
    studentId: parsed.studentId,
    cohortId: parsed.cohortId,
    enrolledAt: parsed.enrolledAt,
  });

  // project_id se autofillea via trigger desde cohorts.
  // Vigencia: si el operador la escribió explícita, gana; si no, cae al
  // cálculo automático.
  const payload = {
    student_id: parsed.studentId,
    cohort_id: parsed.cohortId,
    sale_id: parsed.saleId ?? resolved.saleId,
    enrolled_at: parsed.enrolledAt,
    access_expires_at: parsed.accessExpiresAt ?? resolved.accessExpiresAt,
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
  // En update, la vigencia se persiste tal cual llega del form (null = sin
  // vencimiento). No re-invocamos el auto-calc para no pisar valores que el
  // operador quiso limpiar a propósito.
  const payload = {
    student_id: parsed.studentId,
    cohort_id: parsed.cohortId,
    sale_id: parsed.saleId,
    enrolled_at: parsed.enrolledAt,
    access_expires_at: parsed.accessExpiresAt,
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
  const enrolledAt = todayYmd();

  for (const studentId of studentIds) {
    // Vigencia + sale por student, según regla override / método de pago.
    const resolved = await resolveAccessExpiryForEnrollment({
      studentId,
      cohortId,
      enrolledAt,
    });

    const payload = {
      student_id: studentId,
      cohort_id: cohortId,
      sale_id: resolved.saleId,
      enrolled_at: enrolledAt,
      access_expires_at: resolved.accessExpiresAt,
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
// Import xlsx — preview + confirm
// ═══════════════════════════════════════════════════════════════════════════
//
// Import masivo desde la página /academia/estudiantes. Cada fila del xlsx
// es UN enrollment: alumno + producto + cohorte + fecha + vigencia.
//
// Un mismo alumno puede aparecer en varias filas (distintos productos/
// cohortes) — se matchea por email y se reusa el student_id (o se crea
// una sola vez y las filas siguientes hittean el cache del batch).
//
// Mismo shape que /financiero/gastos y /financiero/movimientos:
//   - previewStudentsImport(prev, fd)  → cuenta filas válidas + errores
//   - confirmStudentsImport(prev, fd)  → inserta students + enrollments
//   - Ambas leen `file` (File) y `projectId` (string) de FormData.

export interface StudentsImportPreviewOk {
  readonly ok: true;
  readonly validCount: number;
  readonly errorCount: number;
  readonly totalRows: number;
  readonly errors: ReadonlyArray<ParseError>;
}
export type StudentsImportPreviewResult =
  | StudentsImportPreviewOk
  | { ok: false; error: string };

export interface StudentsImportConfirmOk {
  readonly ok: true;
  readonly imported: number;
  readonly errors: ReadonlyArray<ParseError>;
}
export type StudentsImportConfirmResult =
  | StudentsImportConfirmOk
  | { ok: false; error: string };

const IMPORT_BATCH_SIZE = 200;

interface ImportContext {
  readonly buffer: Buffer;
  readonly projectId: string;
}

async function readXlsxAndProject(
  formData: FormData,
): Promise<{ ok: true } & ImportContext | { ok: false; error: string }> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Seleccioná un archivo .xlsx" };
  }
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    return { ok: false, error: "El archivo tiene que ser .xlsx" };
  }
  const projectId = String(formData.get("projectId") ?? "").trim();
  if (!projectId) {
    return { ok: false, error: "Falta el proyecto." };
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  return { ok: true, buffer, projectId };
}

async function loadProductsByName(
  projectId: string,
): Promise<
  | { ok: true; productsByName: Map<string, ProductForImport> }
  | { ok: false; error: string }
> {
  const supabase = await createSupabaseClient();

  // Guard: proyecto existe y es propia.
  const { data: projectRow } = await supabase
    .from("projects")
    .select("id, ownership")
    .eq("id", projectId)
    .maybeSingle();
  const project = projectRow as { id: string; ownership: string } | null;
  if (!project) return { ok: false, error: "No se encontró el proyecto." };
  if (project.ownership !== "propia") {
    return {
      ok: false,
      error:
        "El proyecto no es propia. Academia solo admite ownership='propia'.",
    };
  }

  const [coursesRes, productsRes, cohortsRes] = await Promise.all([
    supabase
      .from("courses")
      .select("id, product_id")
      .eq("project_id", projectId)
      .eq("active", true),
    supabase.from("products").select("id, name"),
    supabase
      .from("cohorts")
      .select("id, name, course_id")
      .eq("project_id", projectId),
  ]);

  const courses = (coursesRes.data ?? []) as unknown as ReadonlyArray<{
    id: string;
    product_id: string;
  }>;
  const products = (productsRes.data ?? []) as unknown as ReadonlyArray<{
    id: string;
    name: string;
  }>;
  const cohorts = (cohortsRes.data ?? []) as unknown as ReadonlyArray<{
    id: string;
    name: string;
    course_id: string | null;
  }>;

  const productNameById = new Map<string, string>();
  for (const p of products) productNameById.set(p.id, p.name);

  const productsByName = new Map<string, ProductForImport>();
  for (const course of courses) {
    const productName = productNameById.get(course.product_id) ?? "—";
    const cohortsByNormalizedName = new Map<string, string>();
    for (const c of cohorts) {
      if (c.course_id === course.id) {
        cohortsByNormalizedName.set(normalizeName(c.name), c.id);
      }
    }
    productsByName.set(normalizeName(productName), {
      productName,
      courseId: course.id,
      cohortsByNormalizedName,
    });
  }

  return { ok: true, productsByName };
}

export async function previewStudentsImport(
  _prev: StudentsImportPreviewResult | null,
  formData: FormData,
): Promise<StudentsImportPreviewResult> {
  const ctx = await readXlsxAndProject(formData);
  if (!ctx.ok) return { ok: false, error: ctx.error };

  const productsRes = await loadProductsByName(ctx.projectId);
  if (!productsRes.ok) return { ok: false, error: productsRes.error };

  try {
    const parsed = await parseStudentsWorkbook(
      ctx.buffer,
      productsRes.productsByName,
    );
    if (parsed.headerError) {
      return { ok: false, error: parsed.headerError };
    }
    return {
      ok: true,
      validCount: parsed.rows.length,
      errorCount: parsed.errors.length,
      totalRows: parsed.totalRows,
      errors: parsed.errors,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error parseando el xlsx",
    };
  }
}

export async function confirmStudentsImport(
  _prev: StudentsImportConfirmResult | null,
  formData: FormData,
): Promise<StudentsImportConfirmResult> {
  const ctx = await readXlsxAndProject(formData);
  if (!ctx.ok) return { ok: false, error: ctx.error };

  const productsRes = await loadProductsByName(ctx.projectId);
  if (!productsRes.ok) return { ok: false, error: productsRes.error };

  try {
    const parsed = await parseStudentsWorkbook(
      ctx.buffer,
      productsRes.productsByName,
    );
    if (parsed.headerError) {
      return { ok: false, error: parsed.headerError };
    }

    if (parsed.rows.length === 0) {
      return { ok: true, imported: 0, errors: parsed.errors };
    }

    const supabase = await createSupabaseClient();
    const insertErrors: ParseError[] = [];
    let imported = 0;

    // Cache student ids por email dentro del batch para no crear dos veces
    // el mismo alumno cuando aparece en varias filas.
    const studentIdByEmail = new Map<string, string>();

    for (let i = 0; i < parsed.rows.length; i += IMPORT_BATCH_SIZE) {
      const slice = parsed.rows.slice(i, i + IMPORT_BATCH_SIZE);

      for (const [offset, row] of slice.entries()) {
        const rowNumber = i + offset + 2; // fila 1 = header
        const outcome = await insertStudentAndEnrollment(
          supabase,
          ctx.projectId,
          row,
          studentIdByEmail,
        );
        if (!outcome.ok) {
          insertErrors.push({ rowNumber, reason: outcome.error });
          continue;
        }
        imported++;
      }
    }

    // Revalidate paths tocados.
    const touchedCohorts = new Set(parsed.rows.map((r) => r.cohort_id));
    for (const cId of touchedCohorts) {
      revalidatePath(`/academia/cohortes/${cId}`);
    }
    revalidatePath("/academia/cohortes");
    revalidatePath("/academia/estudiantes");
    revalidatePath("/academia");

    return {
      ok: true,
      imported,
      errors: [...parsed.errors, ...insertErrors],
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error procesando el xlsx",
    };
  }
}

async function insertStudentAndEnrollment(
  supabase: Awaited<ReturnType<typeof createSupabaseClient>>,
  projectId: string,
  row: StudentImportRow,
  studentIdByEmail: Map<string, string>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // 1) Match por email.
  let studentId: string | null = null;
  const emailLower = row.email ? row.email.trim().toLowerCase() : null;
  if (emailLower) {
    const cached = studentIdByEmail.get(emailLower);
    if (cached) {
      studentId = cached;
    } else {
      const { data: existing } = await supabase
        .from("students")
        .select("id")
        .eq("project_id", projectId)
        .ilike("email", emailLower)
        .maybeSingle();
      const found = existing as { id: string } | null;
      if (found) {
        studentId = found.id;
        studentIdByEmail.set(emailLower, found.id);
      }
    }
  }

  // 2) Crear si no existe.
  if (studentId == null) {
    const studentPayload = {
      project_id: projectId,
      name: row.name,
      email: emailLower,
      phone: row.phone,
      status: "active",
      enrolled_at: row.enrolled_at,
      notes: null,
    } as never;

    const { data: created, error: createErr } = await supabase
      .from("students")
      .insert(studentPayload)
      .select("id")
      .single();

    if (createErr) {
      let message = createErr.message;
      if (createErr.code === "23505") {
        message =
          "Alumno duplicado (email o teléfono coincide con otro del proyecto).";
      } else if (createErr.code === "23514") {
        message = "El proyecto no acepta el insert (ownership o guard).";
      }
      return { ok: false, error: `Alta de alumno: ${message}` };
    }

    const createdRow = created as { id: string } | null;
    if (!createdRow) {
      return { ok: false, error: "Alta de alumno: insert sin fila devuelta." };
    }
    studentId = createdRow.id;
    if (emailLower) studentIdByEmail.set(emailLower, studentId);
  }

  // 3) Insert enrollment.
  const enrPayload = {
    student_id: studentId,
    cohort_id: row.cohort_id,
    sale_id: null,
    enrolled_at: row.enrolled_at,
    access_expires_at: row.access_expires_at,
    status: "active",
    progress_percent: 0,
    notes: row.notes,
  } as never;

  const { error: enrErr } = await supabase
    .from("enrollments")
    .insert(enrPayload);

  if (enrErr) {
    let message = enrErr.message;
    if (enrErr.code === "23505") {
      message = "El alumno ya estaba inscripto en esta cohorte.";
    } else if (enrErr.code === "23514") {
      message = "La cohorte pertenece a otro proyecto que el alumno.";
    }
    return { ok: false, error: `Inscripción: ${message}` };
  }

  return { ok: true };
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
