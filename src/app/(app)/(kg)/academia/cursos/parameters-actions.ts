"use server";

import { revalidatePath } from "next/cache";

import {
  createParameter,
  deleteParameter,
  reorderParameters,
  slugifyToKey,
  updateParameter,
  type ParameterType,
} from "@/lib/academia/parameters";

// ═══════════════════════════════════════════════════════════════════════════
// Server actions para course_parameters (Fase B · 0145, simplificado en 0154).
//
// La UI envía "name" (nombre visible) y el server autogenera la key con
// slugifyToKey. El label queda igual al name. Retrocompat: si el formulario
// envía "key" y "label" explícitos, los respetamos.
//
// El gating fino vive en RLS (can_edit_project).
// ═══════════════════════════════════════════════════════════════════════════

export type UpsertParameterState =
  | { ok: true; parameterId: string }
  | { error: string }
  | null;

export type DeleteParameterResult = { ok: true } | { error: string };

export type ReorderParametersResult = { ok: true } | { error: string };

const TYPES: readonly ParameterType[] = ["boolean", "integer"];

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
  const name = nullIfEmpty(formData.get("name"));
  const explicitKey = nullIfEmpty(formData.get("key"));
  const explicitLabel = nullIfEmpty(formData.get("label"));
  const typeRaw = nullIfEmpty(formData.get("type"));

  if (!courseId) return { error: "Falta el id del curso." };

  // Resolver label y key: si vienen name-only, autogenerar; si vienen
  // explícitos, respetar (retrocompat).
  const label = name ?? explicitLabel;
  if (!label) return { error: "El nombre del parámetro es requerido." };

  const key = explicitKey ?? (name ? slugifyToKey(name) : null);
  if (!key) {
    return {
      error: "El nombre debe tener al menos una letra o número.",
    };
  }

  if (!typeRaw || !(TYPES as readonly string[]).includes(typeRaw)) {
    return { error: "El tipo es inválido (Sí/No o Cantidad)." };
  }
  const type = typeRaw as ParameterType;

  try {
    if (idRaw) {
      // En update no cambiamos la key para no romper referencias externas.
      const updated = await updateParameter(idRaw, { label, type });
      revalidateCourse(courseId);
      return { ok: true, parameterId: updated.id };
    }
    const created = await createParameter({
      course_id: courseId,
      key,
      label,
      type,
    });
    revalidateCourse(courseId);
    return { ok: true, parameterId: created.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    if (message.toLowerCase().includes("duplicate key")) {
      return {
        error: "Ya existe un parámetro con ese nombre en este curso.",
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
