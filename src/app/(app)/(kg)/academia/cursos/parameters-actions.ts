"use server";

import { revalidatePath } from "next/cache";

import {
  createParameter,
  deleteParameter,
  reorderParameters,
  updateParameter,
  type ParameterType,
} from "@/lib/academia/parameters";

// ═══════════════════════════════════════════════════════════════════════════
// Server actions para course_parameters (Fase B · 0145).
//
// El gating fino vive en RLS (can_edit_project). Estas actions asumen que la
// UI ya escondió los controles a roles sin permisos; si un role sin edit
// llega igual, la DB rebota con 42501 (permission denied) o similar.
// ═══════════════════════════════════════════════════════════════════════════

export type UpsertParameterState =
  | { ok: true; parameterId: string }
  | { error: string }
  | null;

export type DeleteParameterResult = { ok: true } | { error: string };

export type ReorderParametersResult = { ok: true } | { error: string };

const TYPES: readonly ParameterType[] = ["boolean", "integer", "text"];

function nullIfEmpty(value: FormDataEntryValue | null): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length === 0 ? null : trimmed;
}

function revalidateCourse(courseId: string): void {
  revalidatePath("/academia/cursos");
  revalidatePath(`/academia/cursos/${courseId}`);
  revalidatePath("/academia");
}

// ─── Upsert ─────────────────────────────────────────────────────────────────

export async function upsertParameter(
  _prev: UpsertParameterState,
  formData: FormData,
): Promise<UpsertParameterState> {
  const idRaw = nullIfEmpty(formData.get("parameter_id"));
  const courseId = nullIfEmpty(formData.get("course_id"));
  const key = nullIfEmpty(formData.get("key"));
  const label = nullIfEmpty(formData.get("label"));
  const typeRaw = nullIfEmpty(formData.get("type"));
  const requiredRaw = formData.get("required");
  const required = String(requiredRaw ?? "").toLowerCase() === "on";

  if (!courseId) return { error: "Falta el id del curso." };
  if (!key) return { error: "La key del parámetro es requerida." };
  if (!label) return { error: "El label del parámetro es requerido." };
  if (!typeRaw || !(TYPES as readonly string[]).includes(typeRaw)) {
    return { error: "El tipo es inválido (boolean | integer | text)." };
  }
  const type = typeRaw as ParameterType;

  try {
    if (idRaw) {
      const updated = await updateParameter(idRaw, {
        key,
        label,
        type,
        required,
      });
      revalidateCourse(courseId);
      return { ok: true, parameterId: updated.id };
    }
    const created = await createParameter({
      course_id: courseId,
      key,
      label,
      type,
      required,
    });
    revalidateCourse(courseId);
    return { ok: true, parameterId: created.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    if (message.toLowerCase().includes("duplicate key")) {
      return {
        error: "Ya existe un parámetro con esa key en este curso.",
      };
    }
    return { error: message };
  }
}

// ─── Delete ─────────────────────────────────────────────────────────────────

export async function deleteParameterAction(
  parameterId: string,
  courseId: string,
): Promise<DeleteParameterResult> {
  if (!parameterId) return { error: "Falta el id del parámetro." };
  if (!courseId) return { error: "Falta el id del curso." };
  try {
    await deleteParameter(parameterId);
    revalidateCourse(courseId);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return { error: message };
  }
}

// ─── Reorder ────────────────────────────────────────────────────────────────

export async function reorderParametersAction(
  courseId: string,
  orderedIds: readonly string[],
): Promise<ReorderParametersResult> {
  if (!courseId) return { error: "Falta el id del curso." };
  try {
    await reorderParameters(courseId, orderedIds);
    revalidateCourse(courseId);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return { error: message };
  }
}
