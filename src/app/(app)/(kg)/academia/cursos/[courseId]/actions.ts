"use server";

import { revalidatePath } from "next/cache";

import {
  createSystem,
  deleteSystem,
  updateSystem,
} from "@/lib/academia/systems";

// ═══════════════════════════════════════════════════════════════════════════
// Server actions para academia_systems (Fase E · 0150).
//
// El gating fino vive en RLS (can_edit_project). project_id lo denormaliza
// el trigger DB — no se pasa desde acá.
// ═══════════════════════════════════════════════════════════════════════════

export type UpsertSystemState =
  | { ok: true; systemId: string }
  | { error: string }
  | null;

export type DeleteSystemResult = { ok: true } | { error: string };

function nullIfEmpty(value: FormDataEntryValue | null): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length === 0 ? null : trimmed;
}

function parseName(raw: FormDataEntryValue | null): string | null {
  const trimmed = String(raw ?? "").trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > 120) return null;
  return trimmed;
}

// ═══════════════════════════════════════════════════════════════════════════
// createSystemAction
// ═══════════════════════════════════════════════════════════════════════════

export async function createSystemAction(
  courseId: string,
  _prev: UpsertSystemState,
  formData: FormData,
): Promise<UpsertSystemState> {
  if (!courseId) return { error: "Falta el id del curso." };

  const name = parseName(formData.get("name"));
  if (name == null) {
    return { error: "El nombre es obligatorio (máximo 120 caracteres)." };
  }

  const color = nullIfEmpty(formData.get("color"));
  const expertRaw = nullIfEmpty(formData.get("expert_team_member_id"));

  try {
    const row = await createSystem({
      course_id: courseId,
      name,
      color,
      expert_team_member_id: expertRaw,
    });
    revalidatePath(`/academia/cursos/${courseId}`);
    return { ok: true, systemId: row.id };
  } catch (e) {
    return { error: translateDbError(e) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// updateSystemAction
// ═══════════════════════════════════════════════════════════════════════════

export async function updateSystemAction(
  courseId: string,
  systemId: string,
  _prev: UpsertSystemState,
  formData: FormData,
): Promise<UpsertSystemState> {
  if (!systemId) return { error: "Falta el id del sistema." };

  const name = parseName(formData.get("name"));
  if (name == null) {
    return { error: "El nombre es obligatorio (máximo 120 caracteres)." };
  }

  const color = nullIfEmpty(formData.get("color"));
  const expertRaw = nullIfEmpty(formData.get("expert_team_member_id"));
  const activeRaw = formData.get("active");
  const active = activeRaw === null ? true : String(activeRaw) === "on";

  try {
    await updateSystem(systemId, {
      name,
      color,
      expert_team_member_id: expertRaw,
      active,
    });
    revalidatePath(`/academia/cursos/${courseId}`);
    return { ok: true, systemId };
  } catch (e) {
    return { error: translateDbError(e) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// deleteSystemAction
//
// on delete set null en cohorts.system_id (0151) hace que las cohortes
// asignadas queden sin sistema — no hay que confirmarlas ni migrar nada.
// ═══════════════════════════════════════════════════════════════════════════

export async function deleteSystemAction(
  courseId: string,
  systemId: string,
): Promise<DeleteSystemResult> {
  if (!systemId) return { error: "Falta el id del sistema." };
  try {
    await deleteSystem(systemId);
    revalidatePath(`/academia/cursos/${courseId}`);
    return { ok: true };
  } catch (e) {
    return { error: translateDbError(e) };
  }
}

function translateDbError(e: unknown): string {
  const err = e as { code?: string; message?: string } | null;
  if (!err) return "Error desconocido";
  if (err.code === "23505") {
    return "Ya existe un sistema con ese nombre en el curso.";
  }
  if (err.code === "23514") {
    if (err.message?.includes("propia")) {
      return "El proyecto no es 'propia'. Sistemas solo aplican a cursos de proyectos propios.";
    }
    return err.message ?? "Violación de constraint.";
  }
  return err.message ?? "Error al guardar";
}
