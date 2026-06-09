/**
 * Single source of truth for client-side permission checks.
 *
 * Mirrors the SQL helpers:
 *   - 0002_functions.sql  → is_superadmin(), has_project_access(), can_edit_project()
 *   - 0010_back_to_project_scope.sql → can_edit_launches_in()
 *
 * These TS functions are mirror images for UI gating only. RLS is the
 * authoritative enforcer; never trust this module for security.
 *
 * Modelo project-scope (decisión 2026-06-09): pertenencia a un proyecto da
 * acceso a TODOS sus launches; el `can_edit` se deriva del rol, no se asigna
 * por launch.
 */

export type Role = "superadmin" | "admin" | "operador" | "analista" | "cliente";

/**
 * Minimal shape consumed by every gate below. `SessionProfile`
 * (`@/lib/supabase/auth`) es asignable a esto, así los callers pasan el
 * profile directo sin conversión.
 */
export interface SessionContext {
  role: Role;
  /** Project IDs el usuario es miembro (vía `project_members`). */
  memberOfProjectIds: ReadonlySet<string>;
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
 * Project-wide writes: crear/borrar launches, editar proyecto, editar
 * integraciones, manage members. Admin y superadmin only.
 */
export function canEditProject(ctx: SessionContext, projectId: string): boolean {
  if (isSuperadmin(ctx)) return true;
  if (!isAdmin(ctx)) return false;
  return ctx.memberOfProjectIds.has(projectId);
}

/**
 * UPDATE en launches (la fila del launch + launch_daily). Admin y operador
 * miembros del proyecto pasan; analista y cliente nunca.
 * Mirror del SQL `can_edit_launches_in(project_id)`.
 */
export function canEditLaunchesIn(
  ctx: SessionContext,
  projectId: string,
): boolean {
  if (isSuperadmin(ctx)) return true;
  if (!ctx.memberOfProjectIds.has(projectId)) return false;
  return isAdmin(ctx) || isOperador(ctx);
}

// ─── Feature gates ──────────────────────────────────────────────────────────

/**
 * Gestión de usuarios. Default Fase 2: superadmin-only.
 */
export function canManageUsers(ctx: SessionContext): boolean {
  return isSuperadmin(ctx);
}

export function canCreateProjects(ctx: SessionContext): boolean {
  return isSuperadmin(ctx);
}

/**
 * Calculadora abierta a todos los roles (decisión 2026-06-09). Para
 * restringirla a no-cliente, devolver `!isCliente(ctx)`.
 */
export function canUseCalculator(_ctx: SessionContext): boolean {
  return true;
}

/** Audit log read access. Operador y cliente quedan afuera. */
export function canViewAuditLog(ctx: SessionContext, projectId: string): boolean {
  if (isSuperadmin(ctx)) return true;
  if (!ctx.memberOfProjectIds.has(projectId)) return false;
  return isAdmin(ctx) || isAnalista(ctx);
}

/**
 * Aliases for the create/delete launch buttons in the UI; ambos resuelven a
 * project-level write porque el operador nunca crea ni borra launches.
 */
export function canCreateLaunch(ctx: SessionContext, projectId: string): boolean {
  return canEditProject(ctx, projectId);
}

export function canDeleteLaunch(ctx: SessionContext, projectId: string): boolean {
  return canEditProject(ctx, projectId);
}
