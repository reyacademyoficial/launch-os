import "server-only";

import { createClient } from "@/lib/supabase/server";

import type { TeamMemberRow } from "./types";

/**
 * All team_members for an organization the caller can read. RLS filters
 * cross-tenant silently — una org ajena devuelve [].
 *
 * Post 0124: team_members es org-scope. Antes tomaba projectId y filtraba por
 * project_id; ahora el mismo equipo comercial funciona para todos los
 * proyectos de la org.
 */
export async function listTeamMembers(
  organizationId: string,
): Promise<TeamMemberRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("team_members")
    .select("*")
    .eq("organization_id", organizationId)
    .order("active", { ascending: false })
    .order("name", { ascending: true });

  return (data ?? []) as unknown as TeamMemberRow[];
}

/**
 * Conveniencia para pantallas project-scope (leads/ventas/cobros/ranking de un
 * proyecto). Resuelve el organization_id del proyecto y llama a
 * listTeamMembers. Si el projectId no existe o no es accesible, devuelve [].
 */
export async function listTeamMembersForProject(
  projectId: string,
): Promise<TeamMemberRow[]> {
  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("organization_id")
    .eq("id", projectId)
    .maybeSingle();
  const orgId = (project as { organization_id: string } | null)?.organization_id;
  if (!orgId) return [];

  const { data } = await supabase
    .from("team_members")
    .select("*")
    .eq("organization_id", orgId)
    .order("active", { ascending: false })
    .order("name", { ascending: true });

  return (data ?? []) as unknown as TeamMemberRow[];
}

/**
 * Todos los team_members accesibles al usuario por RLS (todas las orgs
 * visibles — hoy siempre una). Consumido por `/comercial/equipo`.
 */
export async function listAllTeamMembers(): Promise<TeamMemberRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("team_members")
    .select("*")
    .order("active", { ascending: false })
    .order("name", { ascending: true });
  return (data ?? []) as unknown as TeamMemberRow[];
}
