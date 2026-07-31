import "server-only";

import { createClient } from "@/lib/supabase/server";

import type { TeamMemberRow } from "./types";

/**
 * All team_members for a project the caller can read. RLS filters cross-tenant
 * silently — un projectId ajeno devuelve [].
 */
export async function listTeamMembers(projectId: string): Promise<TeamMemberRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("team_members")
    .select("*")
    .eq("project_id", projectId)
    .order("active", { ascending: false })
    .order("name", { ascending: true });

  return (data ?? []) as unknown as TeamMemberRow[];
}

/**
 * Todos los team_members accesibles al usuario por RLS (todos los proyectos
 * visibles). Superadmin ve todos. Consumido por `/comercial/equipo` que
 * administra el equipo cross-proyecto.
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
