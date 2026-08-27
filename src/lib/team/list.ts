import "server-only";

import { getKgTeamMembers } from "@/lib/kg/reference";

import type { TeamMemberRow } from "./types";

/**
 * All team_members for an organization the caller can read. RLS filters
 * cross-tenant silently — una org ajena devuelve [].
 *
 * Post 0124: team_members es org-scope. Antes tomaba projectId y filtraba por
 * project_id; ahora el mismo equipo comercial funciona para todos los
 * proyectos de la org.
 *
 * En single-org (hoy) equivale a `getKgTeamMembers()` — ambos filtran por la
 * org actual. Se preserva la signature por compat de callers.
 */
export async function listTeamMembers(
  _organizationId: string,
): Promise<TeamMemberRow[]> {
  return getKgTeamMembers();
}

/**
 * Conveniencia para pantallas project-scope (leads/ventas/cobros/ranking de un
 * proyecto). En el modelo actual todos los team_members son de la única org,
 * así que devuelve el mismo listado que `listAllTeamMembers` — igual
 * mantenemos la signature por compat.
 */
export async function listTeamMembersForProject(
  _projectId: string,
): Promise<TeamMemberRow[]> {
  return getKgTeamMembers();
}

/**
 * Todos los team_members accesibles al usuario por RLS (todas las orgs
 * visibles — hoy siempre una). Consumido por `/comercial/equipo`.
 *
 * Va por el cache de kg/reference (org-scope). Los callers son todos del
 * shell (kg), no del portal.
 */
export async function listAllTeamMembers(): Promise<TeamMemberRow[]> {
  return getKgTeamMembers();
}
