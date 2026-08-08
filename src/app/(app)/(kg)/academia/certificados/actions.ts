"use server";

import { revalidatePath } from "next/cache";

import { createClient as createSupabaseClient } from "@/lib/supabase/server";

// ═══════════════════════════════════════════════════════════════════════════
// CRUD de certificates (bloque 4 · 0078).
//
// Emisión manual — no hay automatismo al aprobar exámenes (decisión de
// negocio). code es unique global (opcional al momento de emitir).
// Unique (student_id, course_id): un student tiene un solo cert por
// course. Re-emisión = editar el existente.
//
// project_id lo autofillea el trigger `a_check_consistency` desde
// course.project_id (validando que sea igual a student.project_id, sino
// rebota 23514). guard_propia_project rebota si el project no es propia.
// ═══════════════════════════════════════════════════════════════════════════

export type CreateCertificateState =
  | { ok: true; certificateId: string }
  | { error: string }
  | null;

export type UpdateCertificateState =
  | { ok: true }
  | { error: string }
  | null;

export type DeleteCertificateResult = { ok: true } | { error: string };

const YMD_RX = /^\d{4}-\d{2}-\d{2}$/;

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
    msg.includes("course.project_id")
  ) {
    return "El estudiante y el curso son de proyectos distintos. Elegí un curso del mismo proyecto propio.";
  }
  return msg;
}

function translateUniqueError(msg: string, code?: string): string | null {
  // Unique (student_id, course_id) — cert por (student, course).
  if (
    msg.includes("certificates") &&
    (msg.includes("student_id") || msg.includes("course_id"))
  ) {
    return "Este estudiante ya tiene un certificado de este curso. Editá el existente en vez de emitir uno nuevo.";
  }
  // Unique global sobre code.
  if (msg.includes("code")) {
    return "Ya existe un certificado con ese código. Los códigos son únicos en toda la organización.";
  }
  if (code === "23505") {
    return "Ya existe un certificado con esos datos.";
  }
  return null;
}

interface CertificatePayload {
  readonly studentId: string;
  readonly courseId: string;
  readonly code: string | null;
  readonly issuedAt: string;
  readonly url: string | null;
  readonly notes: string | null;
}

function parseCertificateFormData(
  formData: FormData,
): CertificatePayload | string {
  const studentId = nullIfEmpty(formData.get("student_id"));
  if (studentId == null) return "Elegí un estudiante.";

  const courseId = nullIfEmpty(formData.get("course_id"));
  if (courseId == null) return "Elegí un curso.";

  const code = nullIfEmpty(formData.get("code"));
  if (code != null && code.length > 100) {
    return "El código es demasiado largo (máximo 100 caracteres).";
  }

  const issuedAt = nullIfEmpty(formData.get("issued_at"));
  if (issuedAt == null || !YMD_RX.test(issuedAt)) {
    return "La fecha de emisión es obligatoria.";
  }

  const url = nullIfEmpty(formData.get("url"));
  if (url != null) {
    if (url.length > 1000) return "La URL es demasiado larga.";
    try {
      // Validación mínima: que sea parseable como URL. Aceptamos http/https.
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return "La URL debe empezar con http:// o https://.";
      }
    } catch {
      return "La URL no es válida.";
    }
  }

  const notes = nullIfEmpty(formData.get("notes"));

  return {
    studentId,
    courseId,
    code,
    issuedAt,
    url,
    notes,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// createCertificate
// ═══════════════════════════════════════════════════════════════════════════

export async function createCertificate(
  _prev: CreateCertificateState,
  formData: FormData,
): Promise<CreateCertificateState> {
  const parsed = parseCertificateFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createSupabaseClient();
  const payload = {
    student_id: parsed.studentId,
    course_id: parsed.courseId,
    code: parsed.code,
    issued_at: parsed.issuedAt,
    url: parsed.url,
    notes: parsed.notes,
  } as never;

  const { data, error } = await supabase
    .from("certificates")
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      const translated = translateUniqueError(error.message, error.code);
      if (translated) return { error: translated };
    }
    if (error.code === "23514") {
      return { error: translateCheckError(error.message) };
    }
    return { error: error.message };
  }

  const created = data as { id: string } | null;
  if (!created) return { error: "El insert no devolvió fila." };

  revalidatePath("/academia/certificados");
  revalidatePath(`/academia/estudiantes/${parsed.studentId}`);
  revalidatePath("/academia");
  return { ok: true, certificateId: created.id };
}

// ═══════════════════════════════════════════════════════════════════════════
// updateCertificate
// ═══════════════════════════════════════════════════════════════════════════

export async function updateCertificate(
  certificateId: string,
  _prev: UpdateCertificateState,
  formData: FormData,
): Promise<UpdateCertificateState> {
  if (!certificateId) return { error: "Falta el id del certificado." };

  const parsed = parseCertificateFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createSupabaseClient();
  const payload = {
    student_id: parsed.studentId,
    course_id: parsed.courseId,
    code: parsed.code,
    issued_at: parsed.issuedAt,
    url: parsed.url,
    notes: parsed.notes,
  } as never;

  const { error } = await supabase
    .from("certificates")
    .update(payload)
    .eq("id", certificateId);

  if (error) {
    if (error.code === "23505") {
      const translated = translateUniqueError(error.message, error.code);
      if (translated) return { error: translated };
    }
    if (error.code === "23514") {
      return { error: translateCheckError(error.message) };
    }
    return { error: error.message };
  }

  revalidatePath("/academia/certificados");
  revalidatePath(`/academia/estudiantes/${parsed.studentId}`);
  revalidatePath("/academia");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// deleteCertificate — hard delete. Los certificados son documentos
// oficiales; si el operador se equivoca al emitir, borrar es la salida.
// No hay soft-delete porque no hay concepto de "revocado" separado.
// ═══════════════════════════════════════════════════════════════════════════

export async function deleteCertificate(
  certificateId: string,
): Promise<DeleteCertificateResult> {
  if (!certificateId) return { error: "Falta el id del certificado." };

  const supabase = await createSupabaseClient();

  const { data: existing } = await supabase
    .from("certificates")
    .select("student_id")
    .eq("id", certificateId)
    .maybeSingle();
  const studentId =
    (existing as { student_id: string } | null)?.student_id ?? null;

  const { error } = await supabase
    .from("certificates")
    .delete()
    .eq("id", certificateId);
  if (error) return { error: error.message };

  revalidatePath("/academia/certificados");
  if (studentId) revalidatePath(`/academia/estudiantes/${studentId}`);
  revalidatePath("/academia");
  return { ok: true };
}
