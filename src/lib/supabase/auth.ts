import "server-only";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export type Role =
  | "dev"
  | "superadmin"
  | "admin"
  | "operador"
  | "coordinador"
  | "cliente";

export interface SessionProfile {
  id: string;
  email: string | null;
  fullName: string | null;
  role: Role;
  /** true cuando el usuario tiene privilegios dev, independientemente del role visible. */
  isDevPrivileged: boolean;
  /**
   * Project IDs el usuario es miembro vía `project_members`. Vacío para
   * superadmin (que no carga rows acá por diseño). Es lo único que necesita
   * la UI para gatear pertenencia — el `can_edit` se deriva del rol.
   */
  memberOfProjectIds: ReadonlySet<string>;
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
  is_dev_privileged: boolean;
}

interface ProjectMemberSummary {
  project_id: string;
}

/**
 * Returns the authenticated user + their profile row + project memberships,
 * or null. RLS-friendly: profiles_select y project_members_select dejan
 * leer las propias.
 */
export async function getSessionProfile(): Promise<SessionProfile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Cast en el límite: postgrest-js colapsa inferencia a `never` por el
  // marcador __InternalSupabase en el Database type (workaround conocido).
  // Soft-deleted profiles (`deleted_at` not null) leen como "no profile".
  const [profileResult, membersResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, role, is_dev_privileged")
      .eq("id", user.id)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase.from("project_members").select("project_id").eq("user_id", user.id),
  ]);

  const profile = profileResult.data as ProfileSummary | null;
  if (profileResult.error || !profile) return null;

  const memberRows = (membersResult.data ?? []) as ProjectMemberSummary[];
  const memberOfProjectIds = new Set<string>(memberRows.map((r) => r.project_id));

  return {
    id: profile.id,
    email: user.email ?? null,
    fullName: profile.full_name,
    role: profile.role as Role,
    isDevPrivileged: profile.is_dev_privileged,
    memberOfProjectIds,
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
 * If the caller's role isn't in the allowed list, redirect based on role:
 *   cliente      → /lanzamientos (su única vista en KG)
 *   operador     → /operaciones  (su módulo principal)
 *   coordinador  → /operaciones  (no ve Ejecutivo/Financiero/Comercial)
 *   others       → /             (dashboard ejecutivo)
 * 'dev' siempre pasa — rol de override fuera del modelo de permisos.
 */
export async function requireRole(
  ...allowed: readonly [Role, ...Role[]]
): Promise<SessionProfile> {
  const profile = await requireSessionProfile();
  if (profile.role === "dev" || profile.isDevPrivileged) return profile;
  if (!allowed.includes(profile.role)) {
    if (profile.role === "cliente") redirect("/lanzamientos");
    if (profile.role === "operador") redirect("/operaciones");
    if (profile.role === "coordinador") redirect("/operaciones");
    redirect("/");
  }
  return profile;
}

/**
 * Project-wide write check. Mirror del SQL `can_edit_project`: superadmin O
 * (admin miembro). Operador, coordinador, cliente: false. Gate de CREATE/DELETE
 * de launches + edits del proyecto + edits de integraciones.
 */
export async function userCanEditProject(projectId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.rpc(
    "can_edit_project",
    { p_project_id: projectId } as never,
  );
  return data === true;
}

/**
 * Write check para launches/launch_daily a nivel proyecto. Mirror del SQL
 * `can_edit_launches_in`: superadmin O (miembro con rol admin|operador).
 * Coordinador y cliente: false.
 */
export async function userCanEditLaunchesIn(projectId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.rpc(
    "can_edit_launches_in",
    { p_project_id: projectId } as never,
  );
  return data === true;
}

/**
 * Defense-in-depth layer 2 para create/delete launches + edits del proyecto.
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
 * Defense-in-depth layer 2 para UPDATE de launches y operaciones de
 * launch_daily. Operadores miembros del proyecto pasan; coordinador y cliente
 * caen al overview.
 */
export async function requireCanEditLaunchesIn(
  projectId: string,
): Promise<SessionProfile> {
  const profile = await requireSessionProfile();
  if (!(await userCanEditLaunchesIn(projectId))) {
    redirect(`/proyectos/${projectId}`);
  }
  return profile;
}
