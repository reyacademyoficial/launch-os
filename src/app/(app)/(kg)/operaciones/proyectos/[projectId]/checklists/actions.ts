"use server";

import { revalidatePath } from "next/cache";

import { resolveCurrentOrganizationId } from "@/lib/organization/current";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

// ═══════════════════════════════════════════════════════════════════════════
// CRUD de checklists + checklist_items para un internal_project.
//
// checklists (0093) tiene XOR duro entre task_id y internal_project_id.
// Este set de actions hardcodea internal_project_id — para hacer
// checklists de tareas, se replica el patrón cuando exista task detail.
//
// checklist_items cascadeacan cuando se borra la checklist padre.
// ═══════════════════════════════════════════════════════════════════════════

export type CreateChecklistResult =
  | { ok: true; checklistId: string }
  | { error: string };

export type UpdateChecklistResult = { ok: true } | { error: string };

export type DeleteChecklistResult = { ok: true } | { error: string };

export type CreateItemResult =
  | { ok: true; itemId: string }
  | { error: string };

export type UpdateItemResult = { ok: true } | { error: string };

export type DeleteItemResult = { ok: true } | { error: string };

function nullIfEmpty(value: FormDataEntryValue | null): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length === 0 ? null : trimmed;
}

// ═══════════════════════════════════════════════════════════════════════════
// CHECKLIST
// ═══════════════════════════════════════════════════════════════════════════

export async function createProjectChecklist(
  projectId: string,
  formData: FormData,
): Promise<CreateChecklistResult> {
  if (!projectId) return { error: "Falta el id del proyecto." };
  const title = nullIfEmpty(formData.get("title"));
  if (title == null) return { error: "El título es obligatorio." };
  if (title.length > 300) return { error: "El título es demasiado largo." };

  let organizationId: string | null;
  try {
    organizationId = await resolveCurrentOrganizationId();
  } catch (e) {
    return {
      error:
        e instanceof Error ? e.message : "Error resolviendo la organización.",
    };
  }
  if (!organizationId) return { error: "No pudimos resolver tu organización." };

  const supabase = await createSupabaseClient();
  const payload = {
    organization_id: organizationId,
    internal_project_id: projectId,
    task_id: null,
    title,
  } as never;

  const { data, error } = await supabase
    .from("checklists")
    .insert(payload)
    .select("id")
    .single();

  if (error) return { error: error.message };
  const created = data as { id: string } | null;
  if (!created) return { error: "El insert no devolvió fila." };

  revalidatePath(`/operaciones/proyectos/${projectId}`);
  return { ok: true, checklistId: created.id };
}

export async function renameChecklist(
  checklistId: string,
  title: string,
): Promise<UpdateChecklistResult> {
  if (!checklistId) return { error: "Falta el id del checklist." };
  const trimmed = title.trim();
  if (trimmed.length === 0) return { error: "El título es obligatorio." };
  if (trimmed.length > 300) return { error: "El título es demasiado largo." };

  const supabase = await createSupabaseClient();

  const { data: existing } = await supabase
    .from("checklists")
    .select("internal_project_id")
    .eq("id", checklistId)
    .maybeSingle();
  const projectId =
    (existing as { internal_project_id: string | null } | null)
      ?.internal_project_id ?? null;

  const payload = { title: trimmed } as never;
  const { error } = await supabase
    .from("checklists")
    .update(payload)
    .eq("id", checklistId);
  if (error) return { error: error.message };

  if (projectId) revalidatePath(`/operaciones/proyectos/${projectId}`);
  return { ok: true };
}

export async function deleteChecklist(
  checklistId: string,
): Promise<DeleteChecklistResult> {
  if (!checklistId) return { error: "Falta el id del checklist." };

  const supabase = await createSupabaseClient();

  const { data: existing } = await supabase
    .from("checklists")
    .select("internal_project_id")
    .eq("id", checklistId)
    .maybeSingle();
  const projectId =
    (existing as { internal_project_id: string | null } | null)
      ?.internal_project_id ?? null;

  // checklist_items cascadeacan por FK on delete cascade.
  const { error } = await supabase
    .from("checklists")
    .delete()
    .eq("id", checklistId);
  if (error) return { error: error.message };

  if (projectId) revalidatePath(`/operaciones/proyectos/${projectId}`);
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// CHECKLIST ITEMS
// ═══════════════════════════════════════════════════════════════════════════

export async function addChecklistItem(
  checklistId: string,
  formData: FormData,
): Promise<CreateItemResult> {
  if (!checklistId) return { error: "Falta el id del checklist." };
  const content = nullIfEmpty(formData.get("content"));
  if (content == null) return { error: "El contenido es obligatorio." };

  let organizationId: string | null;
  try {
    organizationId = await resolveCurrentOrganizationId();
  } catch (e) {
    return {
      error:
        e instanceof Error ? e.message : "Error resolviendo la organización.",
    };
  }
  if (!organizationId) return { error: "No pudimos resolver tu organización." };

  const supabase = await createSupabaseClient();

  // Position = max(position) + 1 dentro del checklist. Sin unique.
  const { data: maxRow } = await supabase
    .from("checklist_items")
    .select("position")
    .eq("checklist_id", checklistId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextPosition =
    ((maxRow as { position: number } | null)?.position ?? -1) + 1;

  // Necesitamos el internal_project_id del parent para revalidar.
  const { data: checklist } = await supabase
    .from("checklists")
    .select("internal_project_id")
    .eq("id", checklistId)
    .maybeSingle();
  const projectId =
    (checklist as { internal_project_id: string | null } | null)
      ?.internal_project_id ?? null;

  const payload = {
    organization_id: organizationId,
    checklist_id: checklistId,
    content,
    done: false,
    position: nextPosition,
  } as never;

  const { data, error } = await supabase
    .from("checklist_items")
    .insert(payload)
    .select("id")
    .single();

  if (error) return { error: error.message };
  const created = data as { id: string } | null;
  if (!created) return { error: "El insert no devolvió fila." };

  if (projectId) revalidatePath(`/operaciones/proyectos/${projectId}`);
  return { ok: true, itemId: created.id };
}

export async function toggleChecklistItem(
  itemId: string,
  done: boolean,
): Promise<UpdateItemResult> {
  if (!itemId) return { error: "Falta el id del item." };

  const supabase = await createSupabaseClient();

  // Traemos el project_id del parent para revalidar.
  const { data: item } = await supabase
    .from("checklist_items")
    .select("checklist_id")
    .eq("id", itemId)
    .maybeSingle();
  const checklistId = (item as { checklist_id: string } | null)?.checklist_id;
  let projectId: string | null = null;
  if (checklistId) {
    const { data: checklist } = await supabase
      .from("checklists")
      .select("internal_project_id")
      .eq("id", checklistId)
      .maybeSingle();
    projectId =
      (checklist as { internal_project_id: string | null } | null)
        ?.internal_project_id ?? null;
  }

  const payload = {
    done,
    done_at: done ? new Date().toISOString() : null,
  } as never;

  const { error } = await supabase
    .from("checklist_items")
    .update(payload)
    .eq("id", itemId);
  if (error) return { error: error.message };

  if (projectId) revalidatePath(`/operaciones/proyectos/${projectId}`);
  return { ok: true };
}

export async function deleteChecklistItem(
  itemId: string,
): Promise<DeleteItemResult> {
  if (!itemId) return { error: "Falta el id del item." };

  const supabase = await createSupabaseClient();

  const { data: item } = await supabase
    .from("checklist_items")
    .select("checklist_id")
    .eq("id", itemId)
    .maybeSingle();
  const checklistId = (item as { checklist_id: string } | null)?.checklist_id;
  let projectId: string | null = null;
  if (checklistId) {
    const { data: checklist } = await supabase
      .from("checklists")
      .select("internal_project_id")
      .eq("id", checklistId)
      .maybeSingle();
    projectId =
      (checklist as { internal_project_id: string | null } | null)
        ?.internal_project_id ?? null;
  }

  const { error } = await supabase
    .from("checklist_items")
    .delete()
    .eq("id", itemId);
  if (error) return { error: error.message };

  if (projectId) revalidatePath(`/operaciones/proyectos/${projectId}`);
  return { ok: true };
}
