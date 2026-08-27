import "server-only";

import { unstable_cache } from "next/cache";

import { resolveCurrentOrganizationId } from "@/lib/organization/current";
import type { ProjectListItem } from "@/lib/projects/list";
import { createServiceClient } from "@/lib/supabase/service";
import type { TeamMemberRow } from "@/lib/team/types";

/**
 * Cache de datos de referencia compartidos entre módulos del shell (kg):
 * Financiero, Comercial, Clientes, Operaciones, Academia, Marketing.
 *
 *   - projects       — todos los proyectos de la org (sin filtro por rol).
 *   - team_members   — nómina comercial org-scope (post 0124).
 *
 * IMPORTANTE: `getKgProjects()` NO es equivalente a `listAccessibleProjects()`.
 * La segunda respeta RLS por rol (cliente ve solo sus project_members). Este
 * cache devuelve TODOS los proyectos de la org y es seguro únicamente para
 * pantallas del shell (kg) — donde solo entran superadmin/admin/coordinador/
 * operador (todos ven todo). Para /portal (cliente), seguir usando
 * `listAccessibleProjects()`.
 */

export function tagKgProjects(orgId: string): string {
  return `kg:${orgId}:projects`;
}
export function tagKgTeamMembers(orgId: string): string {
  return `kg:${orgId}:team-members`;
}

export async function currentOrgTagsKg(): Promise<{
  readonly projects: string;
  readonly teamMembers: string;
} | null> {
  const orgId = await resolveCurrentOrganizationId();
  if (!orgId) return null;
  return {
    projects: tagKgProjects(orgId),
    teamMembers: tagKgTeamMembers(orgId),
  };
}

const REVALIDATE = 300;

function loadKgProjects(orgId: string) {
  return unstable_cache(
    async (): Promise<ProjectListItem[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svc = createServiceClient() as any;
      const { data, error } = await svc
        .from("projects")
        .select("id, name")
        .eq("organization_id", orgId)
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ProjectListItem[];
    },
    ["kg", "projects", orgId],
    { tags: [tagKgProjects(orgId)], revalidate: REVALIDATE },
  )();
}

function loadKgTeamMembers(orgId: string) {
  return unstable_cache(
    async (): Promise<TeamMemberRow[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svc = createServiceClient() as any;
      const { data, error } = await svc
        .from("team_members")
        .select("*")
        .eq("organization_id", orgId)
        .order("active", { ascending: false })
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as TeamMemberRow[];
    },
    ["kg", "team-members", orgId],
    { tags: [tagKgTeamMembers(orgId)], revalidate: REVALIDATE },
  )();
}

async function orgIdOrThrow(): Promise<string> {
  const id = await resolveCurrentOrganizationId();
  if (!id) throw new Error("No hay organización visible para este usuario.");
  return id;
}

export async function getKgProjects(): Promise<ProjectListItem[]> {
  const orgId = await orgIdOrThrow();
  return loadKgProjects(orgId);
}

export async function getKgTeamMembers(): Promise<TeamMemberRow[]> {
  const orgId = await orgIdOrThrow();
  return loadKgTeamMembers(orgId);
}
