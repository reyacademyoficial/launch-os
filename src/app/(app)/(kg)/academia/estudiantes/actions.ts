"use server";

import { revalidatePath } from "next/cache";

import { expireEnrollment } from "@/lib/academia/expirations";
import { requireRole } from "@/lib/supabase/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

// ═══════════════════════════════════════════════════════════════════════════
// CRUD de students (bloque 4 · 0071).
//
// Dos flujos de alta:
//   1) createStudentManual — form vacío, operador tipea todo (usado para
//      históricos sin venta asociada).
//   2) bulkCreateStudentsFromSales — desde la pestaña "Compradores
//      pendientes" en /academia/estudiantes. Crea N students en un solo
//      llamado, con opción a inscribirlos también en una cohort del
//      curso.
//
// Los students son alumnos de proyectos propios. El guard_propia_project
// rebota si project_id no es propia.
//
// Unique parciales del schema 0071:
//   (project_id, phone_normalized) where phone_normalized is not null
//   (project_id, email) where email is not null
// El 23505 se traduce a mensaje claro.
// ═══════════════════════════════════════════════════════════════════════════

const STATUSES = ["active", "inactive", "graduated"] as const;

type Status = (typeof STATUSES)[number];

export type CreateStudentState =
  | { ok: true; studentId: string }
  | { error: string }
  | null;

export interface BulkFailure {
  readonly saleId: string;
  readonly leadName: string;
  readonly error: string;
}

export type BulkCreateFromSalesResult = {
  ok: true;
  createdCount: number;
  enrolledCount: number;
  failures: readonly BulkFailure[];
};

export type UpdateStudentState = { ok: true } | { error: string } | null;

export type DeleteStudentResult = { ok: true } | { error: string };

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

function normalizePhone(phone: string | null): string | null {
  if (phone == null) return null;
  // Minimal: quitar todo lo que no sea + o dígito. El schema tiene un
  // trigger de normalización más completo, esto es defensa.
  const cleaned = phone.replace(/[^\d+]/g, "");
  return cleaned.length === 0 ? null : cleaned;
}

interface StudentPayload {
  readonly projectId: string;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly status: Status;
  readonly enrolledAt: string;
  readonly notes: string | null;
}

const YMD_RX = /^\d{4}-\d{2}-\d{2}$/;

function parseStudentFormData(
  formData: FormData,
): StudentPayload | string {
  const projectId = nullIfEmpty(formData.get("project_id"));
  if (projectId == null) return "Elegí un proyecto.";

  const name = String(formData.get("name") ?? "").trim();
  if (name.length === 0) return "El nombre es obligatorio.";
  if (name.length > 200) return "El nombre es demasiado largo (máximo 200).";

  const emailRaw = nullIfEmpty(formData.get("email"));
  const email = emailRaw ? emailRaw.toLowerCase() : null;

  const phone = normalizePhone(nullIfEmpty(formData.get("phone")));

  const statusRaw = String(formData.get("status") ?? "active").trim();
  if (!(STATUSES as readonly string[]).includes(statusRaw)) {
    return "Estado inválido.";
  }
  const status = statusRaw as Status;

  const enrolledAtRaw = nullIfEmpty(formData.get("enrolled_at"));
  const enrolledAt = enrolledAtRaw ?? todayYmd();
  if (!YMD_RX.test(enrolledAt)) return "La fecha de alta no es válida.";

  const notes = nullIfEmpty(formData.get("notes"));

  return { projectId, name, email, phone, status, enrolledAt, notes };
}

// ═══════════════════════════════════════════════════════════════════════════
// createStudentManual
// ═══════════════════════════════════════════════════════════════════════════

export async function createStudentManual(
  _prev: CreateStudentState,
  formData: FormData,
): Promise<CreateStudentState> {
  const parsed = parseStudentFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createSupabaseClient();
  const payload = {
    project_id: parsed.projectId,
    name: parsed.name,
    email: parsed.email,
    phone: parsed.phone,
    status: parsed.status,
    enrolled_at: parsed.enrolledAt,
    notes: parsed.notes,
  } as never;

  const { data, error } = await supabase
    .from("students")
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return {
        error:
          "Ya existe un estudiante con ese email o teléfono en el proyecto.",
      };
    }
    if (error.code === "23514") {
      return {
        error:
          "El proyecto no es propia. Academia solo admite proyectos con ownership='propia'.",
      };
    }
    return { error: error.message };
  }

  const created = data as { id: string } | null;
  if (!created) return { error: "El insert no devolvió fila." };

  revalidatePath("/academia/estudiantes");
  revalidatePath("/academia");
  return { ok: true, studentId: created.id };
}

// ═══════════════════════════════════════════════════════════════════════════
// bulkCreateStudentsFromSales
//
// Crea N students en un solo llamado, iterando internamente. Errores
// individuales (unique/guard) se agregan en `failures`. Si el operador
// pasa `enrollInCohortId`, además crea los enrollments con `sale_id`
// seteado para trazabilidad LTV.
//
// El caller ya verificó que todos los seleccionados corresponden al
// producto del curso de esa cohort — acá defendemos igualmente en cada
// insert vía el trigger de consistency (rebota 23514 si product mismatch).
// ═══════════════════════════════════════════════════════════════════════════

export async function bulkCreateStudentsFromSales(
  saleIds: readonly string[],
  options: { readonly enrollInCohortId: string | null } = {
    enrollInCohortId: null,
  },
): Promise<BulkCreateFromSalesResult> {
  if (saleIds.length === 0) {
    return { ok: true, createdCount: 0, enrolledCount: 0, failures: [] };
  }

  const supabase = await createSupabaseClient();

  // Traigo todas las sales del batch en una query.
  const { data: salesData } = await supabase
    .from("sales")
    .select("id, project_id, product_id, lead_id")
    .in("id", [...saleIds]);
  const sales = (salesData ?? []) as unknown as ReadonlyArray<{
    id: string;
    project_id: string;
    product_id: string;
    lead_id: string | null;
  }>;

  const leadIds = Array.from(
    new Set(
      sales.map((s) => s.lead_id).filter((v): v is string => v != null),
    ),
  );
  const { data: leadsData } =
    leadIds.length === 0
      ? { data: [] }
      : await supabase
          .from("leads")
          .select("id, name, email, phone_normalized")
          .in("id", leadIds);
  const leads = (leadsData ?? []) as unknown as ReadonlyArray<{
    id: string;
    name: string | null;
    email: string | null;
    phone_normalized: string | null;
  }>;
  const leadById = new Map<string, (typeof leads)[number]>();
  for (const l of leads) leadById.set(l.id, l);

  const salesTouchedProjects = new Set<string>();
  const salesTouchedStudentPaths = new Set<string>();
  const failures: BulkFailure[] = [];
  const createdStudentBySale = new Map<
    string,
    { studentId: string; projectId: string }
  >();

  // Alta secuencial. Un batch pequeño no gana con concurrencia en un
  // server action y el orden de errores es más predecible.
  for (const saleId of saleIds) {
    const sale = sales.find((s) => s.id === saleId);
    if (!sale) {
      failures.push({
        saleId,
        leadName: "—",
        error: "La venta ya no existe o no tenés acceso.",
      });
      continue;
    }
    if (!sale.lead_id) {
      failures.push({
        saleId,
        leadName: "—",
        error: "La venta no tiene lead asociado.",
      });
      continue;
    }
    const lead = leadById.get(sale.lead_id);
    if (!lead || !lead.name) {
      failures.push({
        saleId,
        leadName: lead?.name ?? "—",
        error: "El lead no tiene nombre.",
      });
      continue;
    }

    const payload = {
      project_id: sale.project_id,
      name: lead.name,
      email: lead.email ? lead.email.toLowerCase() : null,
      phone: normalizePhone(lead.phone_normalized),
      status: "active" as Status,
      enrolled_at: todayYmd(),
      notes: null,
    } as never;

    const { data, error } = await supabase
      .from("students")
      .insert(payload)
      .select("id")
      .single();

    if (error) {
      let message = error.message;
      if (error.code === "23505") {
        message =
          "Ya existe un estudiante con ese email o teléfono en el proyecto.";
      } else if (error.code === "23514") {
        message =
          "El proyecto no es propia. Academia solo admite ownership='propia'.";
      }
      failures.push({ saleId, leadName: lead.name, error: message });
      continue;
    }

    const created = data as { id: string } | null;
    if (!created) {
      failures.push({
        saleId,
        leadName: lead.name,
        error: "El insert no devolvió fila.",
      });
      continue;
    }
    createdStudentBySale.set(saleId, {
      studentId: created.id,
      projectId: sale.project_id,
    });
    salesTouchedProjects.add(sale.project_id);
    salesTouchedStudentPaths.add(created.id);
  }

  // Fase 2: si vino cohortId, crear los enrollments para los que se
  // pudieron crear como student. sale_id seteado para trazabilidad.
  let enrolledCount = 0;
  if (options.enrollInCohortId && createdStudentBySale.size > 0) {
    for (const [saleId, entry] of createdStudentBySale) {
      const enrPayload = {
        student_id: entry.studentId,
        cohort_id: options.enrollInCohortId,
        sale_id: saleId,
        enrolled_at: todayYmd(),
        status: "active",
        progress_percent: 0,
        notes: null,
      } as never;

      const { error } = await supabase
        .from("enrollments")
        .insert(enrPayload);

      if (error) {
        let message = error.message;
        if (error.code === "23505") {
          message = "Ya estaba inscripto en esta generación.";
        } else if (error.code === "23514") {
          message =
            "La cohort no coincide con el proyecto/producto del estudiante.";
        }
        // El student SÍ se creó — reportamos como parcial en failures
        // (con studentId en el mensaje para debug).
        failures.push({
          saleId,
          leadName: "(alta ok, falló inscripción)",
          error: message,
        });
        continue;
      }
      enrolledCount++;
    }
  }

  // Revalidations globales.
  revalidatePath("/academia/estudiantes");
  for (const studentId of salesTouchedStudentPaths) {
    revalidatePath(`/academia/estudiantes/${studentId}`);
  }
  if (options.enrollInCohortId) {
    revalidatePath(`/academia/cohortes/${options.enrollInCohortId}`);
  }
  revalidatePath("/academia/cohortes");
  revalidatePath("/academia");

  return {
    ok: true,
    createdCount: createdStudentBySale.size,
    enrolledCount,
    failures,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// updateStudent
// ═══════════════════════════════════════════════════════════════════════════

export async function updateStudent(
  studentId: string,
  _prev: UpdateStudentState,
  formData: FormData,
): Promise<UpdateStudentState> {
  if (!studentId) return { error: "Falta el id del estudiante." };

  const parsed = parseStudentFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createSupabaseClient();
  const payload = {
    project_id: parsed.projectId,
    name: parsed.name,
    email: parsed.email,
    phone: parsed.phone,
    status: parsed.status,
    enrolled_at: parsed.enrolledAt,
    notes: parsed.notes,
  } as never;

  const { error } = await supabase
    .from("students")
    .update(payload)
    .eq("id", studentId);

  if (error) {
    if (error.code === "23505") {
      return {
        error:
          "Ya existe otro estudiante con ese email o teléfono en el proyecto.",
      };
    }
    if (error.code === "23514") {
      return {
        error: "El proyecto no es propia.",
      };
    }
    return { error: error.message };
  }

  revalidatePath("/academia/estudiantes");
  revalidatePath(`/academia/estudiantes/${studentId}`);
  revalidatePath("/academia");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// deleteStudent — hard delete con guard
//
// Bloquea si tiene enrollments, attendance, exams o certificates. Cambiar
// status='inactive' o 'graduated' es la forma normal de "sacar de vista".
// ═══════════════════════════════════════════════════════════════════════════

export async function deleteStudent(
  studentId: string,
): Promise<DeleteStudentResult> {
  if (!studentId) return { error: "Falta el id del estudiante." };

  const supabase = await createSupabaseClient();

  const [enrollmentsRes, attendanceRes, examsRes, certsRes] = await Promise.all([
    supabase
      .from("enrollments")
      .select("id", { count: "exact", head: true })
      .eq("student_id", studentId),
    supabase
      .from("attendance")
      .select("id", { count: "exact", head: true })
      .eq("student_id", studentId),
    supabase
      .from("exams")
      .select("id", { count: "exact", head: true })
      .eq("student_id", studentId),
    supabase
      .from("certificates")
      .select("id", { count: "exact", head: true })
      .eq("student_id", studentId),
  ]);

  const deps: string[] = [];
  const enrCount = enrollmentsRes.count ?? 0;
  const attCount = attendanceRes.count ?? 0;
  const examsCount = examsRes.count ?? 0;
  const certsCount = certsRes.count ?? 0;

  if (enrCount > 0) {
    deps.push(`${enrCount} inscripción${enrCount === 1 ? "" : "es"}`);
  }
  if (attCount > 0) {
    deps.push(`${attCount} asistencia${attCount === 1 ? "" : "s"}`);
  }
  if (examsCount > 0) {
    deps.push(`${examsCount} examen${examsCount === 1 ? "" : "es"}`);
  }
  if (certsCount > 0) {
    deps.push(
      `${certsCount} certificado${certsCount === 1 ? "" : "s"}`,
    );
  }

  if (deps.length > 0) {
    return {
      error:
        `No se puede eliminar: el estudiante tiene ${deps.join(", ")}. ` +
        "Marcalo como inactivo o graduado en su lugar (preserva historial).",
    };
  }

  const { error } = await supabase
    .from("students")
    .delete()
    .eq("id", studentId);
  if (error) return { error: error.message };

  revalidatePath("/academia/estudiantes");
  revalidatePath("/academia");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// expireEnrollmentNow — botón "Dar de baja ahora" en la ficha del alumno
//
// Solo admin/superadmin/coordinador (dev pasa por override en requireRole).
// Marca el enrollment como 'expired', crea el event log y dispara webhook
// GHL si el course tiene URL configurada. La escritura al event log va por
// service_role (RLS 0149 bloquea a authenticated).
// ═══════════════════════════════════════════════════════════════════════════

export type ExpireEnrollmentResult =
  | { ok: true; webhookStatus: string }
  | { error: string };

export async function expireEnrollmentNow(
  enrollmentId: string,
  studentId: string,
): Promise<ExpireEnrollmentResult> {
  if (!enrollmentId) return { error: "Falta el id de la inscripción." };
  await requireRole("superadmin", "admin", "coordinador");

  try {
    const event = await expireEnrollment(enrollmentId, { force: false });
    revalidatePath(`/academia/estudiantes/${studentId}`);
    revalidatePath("/academia/estudiantes");
    revalidatePath("/academia");
    return {
      ok: true,
      webhookStatus: event?.webhook_status ?? "already_expired",
    };
  } catch (err) {
    return {
      error:
        err instanceof Error
          ? err.message
          : "No se pudo dar de baja el enrollment.",
    };
  }
}
