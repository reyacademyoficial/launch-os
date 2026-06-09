"use server";

import { revalidatePath } from "next/cache";

import { requireCanEditProject } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/service";

export type AssignmentActionState = { ok: true } | { error: string } | null;

interface ProfileRow {
  role: string;
}

/**
 * Why service-role for all three actions:
 *   - The caller (admin / superadmin) is already gated by
 *     `requireCanEditProject`; their browser session can write to
 *     `launch_assignments` via RLS too, but service-role lets us also read the
 *     target user's profile to validate role + project membership before
 *     writing, without depending on RLS exposing those rows.
 *
 * URL-tampering guards:
 *   - We re-check that the target user belongs to the launch's project
 *     (`project_members`) and that their role is operador or cliente —
 *     assigning an admin/analista would do nothing because they already see
 *     all launches in the project.
 */

async function assertEligibleAssignee(
  projectId: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const service = createServiceClient();

  const { data: memberRow } = await service
    .from("project_members")
    .select("user_id")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!memberRow) {
    return { ok: false, error: "El usuario no es miembro de este proyecto." };
  }

  const { data: profileRow } = await service
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  const role = (profileRow as ProfileRow | null)?.role;
  if (!role) {
    return { ok: false, error: "No se encontró el perfil del usuario." };
  }
  if (role !== "operador" && role !== "cliente") {
    return {
      ok: false,
      error: "Solo operador y cliente requieren asignación por launch.",
    };
  }

  return { ok: true };
}

/**
 * Assigns a user to a launch. `can_edit` only matters for operador (cliente is
 * always read-only); we still persist the boolean as the form sends it for
 * simplicity, but the RLS helper `can_edit_launch` requires `role = 'operador'`
 * for the assignment branch to grant write — so a `can_edit = true` on a
 * cliente assignment is harmless dead data.
 */
export async function assignUserToLaunch(
  projectId: string,
  launchId: string,
  _prev: AssignmentActionState,
  formData: FormData,
): Promise<AssignmentActionState> {
  await requireCanEditProject(projectId);

  const userId = String(formData.get("user_id") ?? "").trim();
  const canEdit = formData.get("can_edit") === "true";

  if (!userId) return { error: "Elegí un usuario." };

  const eligibility = await assertEligibleAssignee(projectId, userId);
  if (!eligibility.ok) return { error: eligibility.error };

  const service = createServiceClient();
  const payload = {
    launch_id: launchId,
    user_id: userId,
    can_edit: canEdit,
  } as never;
  const { error } = await service
    .from("launch_assignments")
    .insert(payload);

  if (error) {
    if (error.code === "23505") {
      return { error: "Ese usuario ya está asignado al lanzamiento." };
    }
    return { error: error.message };
  }

  revalidatePath(`/proyectos/${projectId}/launches/${launchId}`);
  return { ok: true };
}

/**
 * Toggles `can_edit` on an existing assignment. Used by the per-row switch in
 * the assignees list — only meaningful for operadores.
 */
export async function setAssignmentCanEdit(
  projectId: string,
  launchId: string,
  assignmentId: string,
  canEdit: boolean,
): Promise<void> {
  await requireCanEditProject(projectId);

  const service = createServiceClient();
  const payload = { can_edit: canEdit } as never;
  await service
    .from("launch_assignments")
    .update(payload)
    .eq("id", assignmentId)
    .eq("launch_id", launchId);

  revalidatePath(`/proyectos/${projectId}/launches/${launchId}`);
}

/**
 * Removes an assignment. After this the user loses access to the launch
 * unless they are admin/analista (project-wide) or superadmin.
 */
export async function removeAssignment(
  projectId: string,
  launchId: string,
  assignmentId: string,
): Promise<void> {
  await requireCanEditProject(projectId);

  const service = createServiceClient();
  await service
    .from("launch_assignments")
    .delete()
    .eq("id", assignmentId)
    .eq("launch_id", launchId);

  revalidatePath(`/proyectos/${projectId}/launches/${launchId}`);
}
