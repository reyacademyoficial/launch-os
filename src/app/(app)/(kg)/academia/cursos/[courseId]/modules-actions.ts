"use server";

import { revalidatePath } from "next/cache";

import {
  createModule,
  deleteModule,
  reorderModules,
  updateModule,
} from "@/lib/academia/modules";
import {
  syncTagProgressForCourse,
  type TagSyncResult,
} from "@/lib/integrations/ghl-tag-sync";
import { requireRole } from "@/lib/supabase/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

// ═══════════════════════════════════════════════════════════════════════════
// Server actions de módulos + tag mapping + sync manual (Fase C).
//
// Escritura restringida a admin/superadmin/coordinador (gate en cada action).
// RLS complementa: can_edit_project debe pasar sobre el project del course.
// ═══════════════════════════════════════════════════════════════════════════

function nullIfEmpty(v: FormDataEntryValue | null): string | null {
  const trimmed = String(v ?? "").trim();
  return trimmed.length === 0 ? null : trimmed;
}

// ─── Módulos ────────────────────────────────────────────────────────────────

export type ModuleActionResult = { ok: true } | { error: string };

export async function createCourseModuleAction(
  courseId: string,
  formData: FormData,
): Promise<ModuleActionResult> {
  await requireRole("superadmin", "admin", "coordinador");

  const name = String(formData.get("name") ?? "").trim();
  if (name.length === 0) return { error: "El nombre es obligatorio." };
  if (name.length > 200)
    return { error: "El nombre es demasiado largo (máximo 200 caracteres)." };

  const description = nullIfEmpty(formData.get("description"));

  try {
    await createModule({ course_id: courseId, name, description });
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Error al crear módulo.",
    };
  }

  revalidatePath(`/academia/cursos/${courseId}`);
  return { ok: true };
}

export async function updateCourseModuleAction(
  courseId: string,
  moduleId: string,
  formData: FormData,
): Promise<ModuleActionResult> {
  await requireRole("superadmin", "admin", "coordinador");

  const name = String(formData.get("name") ?? "").trim();
  if (name.length === 0) return { error: "El nombre es obligatorio." };
  const description = nullIfEmpty(formData.get("description"));

  try {
    await updateModule(moduleId, { name, description });
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Error al actualizar módulo.",
    };
  }

  revalidatePath(`/academia/cursos/${courseId}`);
  return { ok: true };
}

export async function deleteCourseModuleAction(
  courseId: string,
  moduleId: string,
): Promise<ModuleActionResult> {
  await requireRole("superadmin", "admin", "coordinador");

  try {
    await deleteModule(moduleId);
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Error al eliminar módulo.",
    };
  }

  revalidatePath(`/academia/cursos/${courseId}`);
  return { ok: true };
}

export async function reorderCourseModulesAction(
  courseId: string,
  orderedIds: readonly string[],
): Promise<ModuleActionResult> {
  await requireRole("superadmin", "admin", "coordinador");

  try {
    await reorderModules(courseId, orderedIds);
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Error al reordenar módulos.",
    };
  }

  revalidatePath(`/academia/cursos/${courseId}`);
  return { ok: true };
}

// ─── Mapping tag GHL ────────────────────────────────────────────────────────

/**
 * Setea (o borra) la tag GHL asociada a un módulo. Unique implícita: cada
 * módulo tiene 0 o 1 mapping. Implementado como delete+insert para evitar
 * complejidad de upsert cuando el mapping ya no existe.
 */
export async function setModuleGhlTagAction(
  courseId: string,
  moduleId: string,
  tag: string | null,
): Promise<ModuleActionResult> {
  await requireRole("superadmin", "admin", "coordinador");

  const cleaned = tag == null ? null : tag.trim();
  const supabase = await createSupabaseClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const loose = supabase as unknown as { from: (name: string) => any };

  // Delete any existing mapping for this module (unique per module).
  const delRes = await loose
    .from("module_ghl_tag_mappings")
    .delete()
    .eq("course_module_id", moduleId);
  if (delRes.error) {
    return { error: delRes.error.message };
  }

  if (cleaned && cleaned.length > 0) {
    // project_id se autofillea por trigger — enviamos placeholder que el
    // trigger before_denorm_project_id_from_module reemplaza.
    const payload = {
      course_module_id: moduleId,
      project_id: moduleId,
      ghl_tag: cleaned,
    } as unknown as never;
    const insRes = await loose
      .from("module_ghl_tag_mappings")
      .insert(payload);
    if (insRes.error) {
      if (insRes.error.code === "23505") {
        return {
          error:
            "Esa tag ya está asignada a otro módulo del proyecto. Usá una distinta.",
        };
      }
      return { error: insRes.error.message };
    }
  }

  revalidatePath(`/academia/cursos/${courseId}`);
  return { ok: true };
}

// ─── Sync manual ────────────────────────────────────────────────────────────

export type ManualSyncResult =
  | { ok: true; summary: TagSyncResult }
  | { error: string };

export async function runManualTagSyncAction(
  courseId: string,
): Promise<ManualSyncResult> {
  await requireRole("superadmin", "admin", "coordinador");

  try {
    const summary = await syncTagProgressForCourse(courseId);
    revalidatePath(`/academia/cursos/${courseId}`);
    return { ok: true, summary };
  } catch (err) {
    return {
      error:
        err instanceof Error ? err.message : "Error al correr el sync manual.",
    };
  }
}
