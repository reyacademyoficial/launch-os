/**
 * Single source of truth for client-side permission checks.
 *
 * The matching SQL helpers live in `supabase/migrations/0002_functions.sql`:
 *   - `public.is_superadmin()`
 *   - `public.has_project_access(p_project_id uuid)`
 *   - `public.can_edit_project(p_project_id uuid)`
 *
 * These TS functions are mirror images for UI gating only. RLS is the
 * authoritative enforcer; never trust this module for security.
 *
 * NOTE: the functional difference between `superadmin` and `admin` is
 * intentionally undefined at this point in the project. When it gets defined,
 * change it here and in `can_edit_project` (and any other affected SQL helper).
 * Do NOT scatter role checks across components or routes.
 */

export type Role = "superadmin" | "admin" | "cliente";

export interface SessionContext {
  userId: string;
  role: Role;
  /** Project IDs the user is a member of (via `project_members`). */
  memberOfProjectIds: ReadonlySet<string>;
}

export function isSuperadmin(ctx: SessionContext): boolean {
  return ctx.role === "superadmin";
}

export function hasProjectAccess(ctx: SessionContext, projectId: string): boolean {
  return isSuperadmin(ctx) || ctx.memberOfProjectIds.has(projectId);
}

export function canEditProject(ctx: SessionContext, projectId: string): boolean {
  if (isSuperadmin(ctx)) return true;
  if (ctx.role !== "admin") return false;
  return ctx.memberOfProjectIds.has(projectId);
}

export function canManageUsers(ctx: SessionContext): boolean {
  // Currently superadmin-only. To open this up to admin, change here AND
  // adjust the SQL policy on `project_members`.
  return isSuperadmin(ctx);
}

export function canCreateProjects(ctx: SessionContext): boolean {
  return isSuperadmin(ctx);
}
