"use server";

import { updateTag } from "next/cache";
import { redirect } from "next/navigation";

import { currentOrgTagsAcademia } from "@/lib/academia/reference";
import { currentOrgTagsKg } from "@/lib/kg/reference";
import { requireRole } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

async function bustProjectsCache(): Promise<void> {
  // Projects impactan (kg) shell + selector de propia en Academia.
  const [kg, aca] = await Promise.all([
    currentOrgTagsKg(),
    currentOrgTagsAcademia(),
  ]);
  if (kg) updateTag(kg.projects);
  if (aca) updateTag(aca.projects);
}

export type ProjectActionState = { error: string } | null;

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

interface ProjectWritePayload {
  name: string;
  business_name: string | null;
}

function parseFromForm(
  formData: FormData,
): { ok: true; payload: ProjectWritePayload } | { ok: false; error: string } {
  const name = str(formData, "name");
  if (!name) return { ok: false, error: "El nombre es obligatorio." };
  const businessName = str(formData, "business_name");

  return {
    ok: true,
    payload: {
      name,
      business_name: businessName.length > 0 ? businessName : null,
    },
  };
}

/**
 * Creates a new project. RLS allows only superadmin via `projects_insert`,
 * which is also what `requireRole("superadmin")` enforces here. Redirects to
 * the list on success.
 */
export async function createProject(
  _prev: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const profile = await requireRole("superadmin");

  const parsed = parseFromForm(formData);
  if (!parsed.ok) return { error: parsed.error };

  const supabase = await createClient();
  // postgrest never-inference workaround on the payload (see memory
  // feedback_supabase_never_inference).
  const insertPayload = {
    ...parsed.payload,
    created_by: profile.id,
  } as never;

  const { error } = await supabase.from("projects").insert(insertPayload);
  if (error) return { error: error.message };

  await bustProjectsCache();
  redirect("/admin/proyectos");
}

/**
 * Updates an existing project's name and/or business_name.
 */
export async function updateProject(
  projectId: string,
  _prev: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  await requireRole("superadmin");

  const parsed = parseFromForm(formData);
  if (!parsed.ok) return { error: parsed.error };

  const supabase = await createClient();
  const updatePayload = parsed.payload as never;
  const { error } = await supabase
    .from("projects")
    .update(updatePayload)
    .eq("id", projectId);

  if (error) return { error: error.message };

  await bustProjectsCache();
  redirect("/admin/proyectos");
}

/**
 * Deletes a project. The database does the cascade via the foreign-key
 * `on delete cascade` declarations from 0001_schema.sql: launches,
 * launch_daily, project_integrations, project_secrets, project_members, and
 * audit_log all go away. UI confirmation is type-DELETE in the modal.
 */
export async function deleteProject(projectId: string): Promise<void> {
  await requireRole("superadmin");

  const supabase = await createClient();
  await supabase.from("projects").delete().eq("id", projectId);

  await bustProjectsCache();
  redirect("/admin/proyectos");
}
