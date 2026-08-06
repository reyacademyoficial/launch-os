"use server";

import { revalidatePath } from "next/cache";

import { createClient as createSupabaseClient } from "@/lib/supabase/server";

// ═══════════════════════════════════════════════════════════════════════════
// CRUD de students (bloque 4 · 0071).
//
// Dos flujos de alta:
//   1) createStudentManual — form vacío, operador tipea todo.
//   2) createStudentFromSale — lee la venta + su lead, auto-fillea el
//      student. Es el flujo primario (la mayoría de estudiantes son
//      compradores de un producto-curso).
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

export type CreateStudentFromSaleResult =
  | { ok: true; studentId: string }
  | { error: string };

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
  readonly notes: string | null;
}

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

  const notes = nullIfEmpty(formData.get("notes"));

  return { projectId, name, email, phone, status, notes };
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
    enrolled_at: todayYmd(),
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
// createStudentFromSale — flujo primario
//
// Lee la sale + su lead, y crea el student con:
//   - project_id = product.project_id (el sale, product y student
//     comparten proyecto propio).
//   - name/email/phone auto-fill del lead.
//
// Notas opcionales que el operador puede agregar antes de crear.
// ═══════════════════════════════════════════════════════════════════════════

interface FromSaleInputs {
  readonly saleId: string;
  readonly notes: string | null;
}

export async function createStudentFromSale(
  inputs: FromSaleInputs,
): Promise<CreateStudentFromSaleResult> {
  const { saleId, notes } = inputs;
  if (!saleId) return { error: "Falta el id de la venta." };

  const supabase = await createSupabaseClient();

  // Traigo sale + product + lead en tres queries (más simple que un
  // select con relaciones anidadas).
  const { data: saleData, error: saleErr } = await supabase
    .from("sales")
    .select("id, project_id, product_id, lead_id")
    .eq("id", saleId)
    .maybeSingle();

  if (saleErr) return { error: saleErr.message };
  const sale = saleData as {
    id: string;
    project_id: string;
    product_id: string;
    lead_id: string | null;
  } | null;
  if (!sale) return { error: "La venta ya no existe o no tenés acceso." };
  if (!sale.lead_id) {
    return {
      error:
        "La venta no tiene lead asociado — no hay datos para completar el estudiante. Cargalo manualmente.",
    };
  }

  const { data: leadData, error: leadErr } = await supabase
    .from("leads")
    .select("name, email, phone")
    .eq("id", sale.lead_id)
    .maybeSingle();

  if (leadErr) return { error: leadErr.message };
  const lead = leadData as {
    name: string | null;
    email: string | null;
    phone: string | null;
  } | null;
  if (!lead || !lead.name) {
    return {
      error:
        "El lead de la venta no tiene nombre. Cargá el estudiante manualmente.",
    };
  }

  const payload = {
    project_id: sale.project_id,
    name: lead.name,
    email: lead.email ? lead.email.toLowerCase() : null,
    phone: normalizePhone(lead.phone),
    status: "active" as Status,
    enrolled_at: todayYmd(),
    notes,
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
          "Ya existe un estudiante con ese email o teléfono en el proyecto. Buscalo en el listado y asignalo a la generación.",
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
