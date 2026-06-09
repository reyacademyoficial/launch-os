/**
 * Single source of truth for client-side permission checks.
 *
 * The matching SQL helpers live in:
 *   - 0002_functions.sql  → is_superadmin(), has_project_access(), can_edit_project()
 *   - 0008_roles_and_launch_assignments.sql → has_launch_access(), can_edit_launch()
 *
 * These TS functions are mirror images for UI gating only. RLS is the
 * authoritative enforcer; never trust this module for security.
 *
 * Two layers of scope live here:
 *   - **Project-level** (admin / analista see their whole project): the project
 *     membership set in SessionContext suffices.
 *   - **Launch-level** (operador / cliente see only assigned launches): the
 *     launchesAssigned map carries one entry per assignment with `canEdit`,
 *     mirroring `launch_assignments.can_edit` in the DB.
 *
 * For per-launch decisions that need to round-trip the DB (e.g. server-side
 * gates for write pages), prefer `userCanEditLaunch` / `userHasLaunchAccess`
 * in `src/lib/supabase/auth.ts` — those call the SQL helpers directly so the
 * verdict matches RLS exactly.
 */

export type Role = "superadmin" | "admin" | "operador" | "analista" | "cliente";

export interface LaunchAssignment {
  /** Mirror of `launch_assignments.can_edit` for the current user. */
  canEdit: boolean;
}

/**
 * Minimal shape consumed by every gate below. Both server-side
 * `SessionProfile` (`@/lib/supabase/auth`) and any future client-side context
 * satisfy this — `SessionProfile` is intentionally assignable, so callers can
 * pass the profile object directly without a conversion step.
 */
export interface SessionContext {
  role: Role;
  /** Project IDs the user is a member of (via `project_members`). */
  memberOfProjectIds: ReadonlySet<string>;
  /**
   * Launch IDs the current user has an explicit row for in
   * `launch_assignments`, keyed by launch id. Admin/analista normally have no
   * rows here — they see launches via project membership.
   */
  launchesAssigned: ReadonlyMap<string, LaunchAssignment>;
}

// ─── Role predicates ────────────────────────────────────────────────────────

export function isSuperadmin(ctx: SessionContext): boolean {
  return ctx.role === "superadmin";
}

export function isAdmin(ctx: SessionContext): boolean {
  return ctx.role === "admin";
}

export function isOperador(ctx: SessionContext): boolean {
  return ctx.role === "operador";
}

export function isAnalista(ctx: SessionContext): boolean {
  return ctx.role === "analista";
}

export function isCliente(ctx: SessionContext): boolean {
  return ctx.role === "cliente";
}

// ─── Project scope (mirror of has_project_access / can_edit_project) ────────

export function hasProjectAccess(ctx: SessionContext, projectId: string): boolean {
  return isSuperadmin(ctx) || ctx.memberOfProjectIds.has(projectId);
}

/**
 * Project-wide writes (create launch, delete launch, edit project, etc.).
 * Analista, operador and cliente always return false here regardless of
 * membership — operador's per-launch edit lives in `canEditLaunch`.
 */
export function canEditProject(ctx: SessionContext, projectId: string): boolean {
  if (isSuperadmin(ctx)) return true;
  if (!isAdmin(ctx)) return false;
  return ctx.memberOfProjectIds.has(projectId);
}

// ─── Launch scope (mirror of has_launch_access / can_edit_launch) ───────────
//
// `launchProjectId` is the launch's parent project — passed in because the
// caller already has it (from URL params or a fetched launch row) and it lets
// us decide admin/analista access without an extra query.

export function hasLaunchAccess(
  ctx: SessionContext,
  launchId: string,
  launchProjectId: string,
): boolean {
  if (isSuperadmin(ctx)) return true;
  if ((isAdmin(ctx) || isAnalista(ctx)) && ctx.memberOfProjectIds.has(launchProjectId)) {
    return true;
  }
  return ctx.launchesAssigned.has(launchId);
}

/**
 * UPDATE-level write on a launch's daily data + the launch row itself (excluding
 * create/delete, which stay at project scope). Operador with `can_edit = true`
 * on the assignment passes; analista and cliente never do.
 */
export function canEditLaunch(
  ctx: SessionContext,
  launchId: string,
  launchProjectId: string,
): boolean {
  if (isSuperadmin(ctx)) return true;
  if (isAdmin(ctx) && ctx.memberOfProjectIds.has(launchProjectId)) return true;
  if (isOperador(ctx)) {
    const assignment = ctx.launchesAssigned.get(launchId);
    return assignment?.canEdit === true;
  }
  return false;
}

// ─── Feature gates (admin pages, calculadora, audit log) ────────────────────
//
// Default flags chosen per the Fase 2 brief; toggle by editing this file (and
// nothing else) when the spec changes.

/**
 * Gestión de usuarios. Fase 2 default: superadmin-only (the admin delegation
 * to project-scope user management is a separate decision deferred per brief
 * §"Decisiones de alcance" item 2).
 */
export function canManageUsers(ctx: SessionContext): boolean {
  return isSuperadmin(ctx);
}

export function canCreateProjects(ctx: SessionContext): boolean {
  return isSuperadmin(ctx);
}

/**
 * Cliente (viewer): per the brief default and the customer-vision doc, cliente
 * sees a reduced executive view — no calculator, no cost simulator. Flip this
 * back to `!isCliente(ctx) || true` (or remove the cliente check) if the
 * stakeholder reverses the call.
 */
export function canUseCalculator(ctx: SessionContext): boolean {
  return !isCliente(ctx);
}

/** Audit log read access. Operador and cliente are excluded by the brief. */
export function canViewAuditLog(ctx: SessionContext, projectId: string): boolean {
  if (isSuperadmin(ctx)) return true;
  if (!ctx.memberOfProjectIds.has(projectId)) return false;
  return isAdmin(ctx) || isAnalista(ctx);
}

/**
 * Assign users to a launch (insert/update/delete on launch_assignments).
 * Admin+/superadmin only — same gate as project-level writes.
 */
export function canAssignLaunches(ctx: SessionContext, projectId: string): boolean {
  return canEditProject(ctx, projectId);
}

/**
 * Convenience aliases for the create/delete launch buttons in the UI; both
 * resolve to project-level write because the operador never creates or
 * deletes launches even when assigned with can_edit.
 */
export function canCreateLaunch(ctx: SessionContext, projectId: string): boolean {
  return canEditProject(ctx, projectId);
}

export function canDeleteLaunch(ctx: SessionContext, projectId: string): boolean {
  return canEditProject(ctx, projectId);
}
