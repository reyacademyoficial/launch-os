import "server-only";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export type Role = "superadmin" | "admin" | "operador" | "analista" | "cliente";

export interface LaunchAssignmentMeta {
  /** Mirror of `launch_assignments.can_edit` for the current user. */
  canEdit: boolean;
}

export interface SessionProfile {
  id: string;
  email: string | null;
  fullName: string | null;
  role: Role;
  /**
   * Project IDs the user belongs to via `project_members`. Empty for
   * superadmin (who has no project_members rows by design).
   */
  memberOfProjectIds: ReadonlySet<string>;
  /**
   * Launches the user is explicitly assigned to via `launch_assignments`,
   * keyed by launch id. Populated for all roles but typically only operador /
   * cliente have entries — admin and analista see launches via project
   * membership, no assignment row needed.
   */
  launchesAssigned: ReadonlyMap<string, LaunchAssignmentMeta>;
}

/**
 * Returns the authenticated user or null. Use when the absence of a session
 * is a valid state (e.g., the login page deciding whether to reverse-redirect).
 */
export async function getSessionUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

interface ProfileSummary {
  id: string;
  full_name: string | null;
  role: string;
}

interface ProjectMemberSummary {
  project_id: string;
}

interface LaunchAssignmentSummary {
  launch_id: string;
  can_edit: boolean;
}

/**
 * Returns the authenticated user + their profile row, or null. Loads project
 * memberships and per-launch assignments in the same round-trip so client-side
 * permission checks (mirrors of `has_launch_access` / `can_edit_launch`) can
 * resolve without an extra query per gate.
 *
 * The profile and membership reads go through RLS — each user can read their
 * own profile, their own project_members rows, and their own
 * launch_assignments rows.
 */
export async function getSessionProfile(): Promise<SessionProfile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Cast at the boundary: postgrest-js inference collapses to `never` when the
  // generated Database type includes the `__InternalSupabase` version marker.
  // Known issue in supabase-js 2.107 + @supabase/ssr 0.6.1. Soft-deleted
  // profiles (`deleted_at` not null) read as "no profile" so the rest of the
  // app treats the user as signed out.
  const [profileResult, membersResult, assignmentsResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, role")
      .eq("id", user.id)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase.from("project_members").select("project_id").eq("user_id", user.id),
    supabase
      .from("launch_assignments")
      .select("launch_id, can_edit")
      .eq("user_id", user.id),
  ]);

  const profile = profileResult.data as ProfileSummary | null;
  if (profileResult.error || !profile) return null;

  const memberRows = (membersResult.data ?? []) as ProjectMemberSummary[];
  const assignmentRows = (assignmentsResult.data ?? []) as LaunchAssignmentSummary[];

  const memberOfProjectIds = new Set<string>(memberRows.map((r) => r.project_id));
  const launchesAssigned = new Map<string, LaunchAssignmentMeta>();
  for (const a of assignmentRows) {
    launchesAssigned.set(a.launch_id, { canEdit: a.can_edit });
  }

  return {
    id: profile.id,
    email: user.email ?? null,
    fullName: profile.full_name,
    role: profile.role as Role,
    memberOfProjectIds,
    launchesAssigned,
  };
}

/**
 * Defense-in-depth layer 2: redirect unauthenticated users to /login.
 * Call from every `(app)` and `(admin)` layout/page that requires a session.
 */
export async function requireSessionProfile(): Promise<SessionProfile> {
  const profile = await getSessionProfile();
  if (!profile) redirect("/login");
  return profile;
}

/**
 * Defense-in-depth layer 2 with a role gate.
 * If the caller's role isn't in the allowed list, redirect to "/".
 */
export async function requireRole(
  ...allowed: readonly [Role, ...Role[]]
): Promise<SessionProfile> {
  const profile = await requireSessionProfile();
  if (!allowed.includes(profile.role)) redirect("/");
  return profile;
}

/**
 * Returns true if the caller can write at project scope (create launch,
 * delete launch, edit project, etc.). Delegates to the SQL helper
 * `can_edit_project` so the rule stays in one place — the same function
 * powers every project-scope RLS write policy.
 */
export async function userCanEditProject(projectId: string): Promise<boolean> {
  const supabase = await createClient();
  // `as never` on rpc args is the postgrest-js inference workaround
  // (see memory feedback_supabase_never_inference).
  const { data } = await supabase.rpc(
    "can_edit_project",
    { p_project_id: projectId } as never,
  );
  return data === true;
}

/**
 * Returns true if the caller can READ a specific launch. Mirrors the SQL
 * helper `has_launch_access` (admin/analista see all launches in their
 * project; operador/cliente only assigned ones; superadmin all).
 */
export async function userHasLaunchAccess(launchId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.rpc(
    "has_launch_access",
    { p_launch_id: launchId } as never,
  );
  return data === true;
}

/**
 * Returns true if the caller can WRITE to a specific launch's data (UPDATE on
 * the launch row + launch_daily). Mirrors `can_edit_launch`:
 *   - superadmin always
 *   - admin on the launch's project
 *   - operador assigned to that launch WITH can_edit = true
 */
export async function userCanEditLaunch(launchId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.rpc(
    "can_edit_launch",
    { p_launch_id: launchId } as never,
  );
  return data === true;
}

/**
 * Defense-in-depth layer 2 for write-only views (create/edit/delete pages and
 * Server Actions). If the caller can't write to the project, redirect to the
 * project overview (where they presumably came from / can still read).
 */
export async function requireCanEditProject(
  projectId: string,
): Promise<SessionProfile> {
  const profile = await requireSessionProfile();
  if (!(await userCanEditProject(projectId))) {
    redirect(`/proyectos/${projectId}`);
  }
  return profile;
}

/**
 * Defense-in-depth layer 2 for launch-write views (launch edit, daily entries,
 * close/reopen). Operadores assigned with can_edit pass; analista and cliente
 * don't. On rejection, bounce to the launch's read-only detail page when the
 * caller still has read access, otherwise to the project overview.
 */
export async function requireCanEditLaunch(
  projectId: string,
  launchId: string,
): Promise<SessionProfile> {
  const profile = await requireSessionProfile();
  if (await userCanEditLaunch(launchId)) return profile;

  if (await userHasLaunchAccess(launchId)) {
    redirect(`/proyectos/${projectId}/launches/${launchId}`);
  }
  redirect(`/proyectos/${projectId}`);
}

/**
 * Defense-in-depth layer 2 for launch read views (detail / daily list). Most
 * pages already get this for free via RLS-filtered queries returning null, but
 * routes that need an explicit redirect on miss can use this.
 */
export async function requireHasLaunchAccess(
  projectId: string,
  launchId: string,
): Promise<SessionProfile> {
  const profile = await requireSessionProfile();
  if (!(await userHasLaunchAccess(launchId))) {
    redirect(`/proyectos/${projectId}`);
  }
  return profile;
}
