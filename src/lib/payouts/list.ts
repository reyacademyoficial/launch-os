import "server-only";

import { createClient } from "@/lib/supabase/server";

import type { TeamMemberPayoutRow } from "./types";

/**
 * Todos los pagos al equipo de un proyecto. RLS filtra cross-tenant (un
 * projectId ajeno devuelve []). El leaderboard agrega esto en memoria contra
 * los miembros — para un proyecto típico el dataset es chico (decenas de
 * miembros × decenas de pagos por launch).
 */
export async function listPayoutsForProject(
  projectId: string,
): Promise<TeamMemberPayoutRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("team_member_payouts")
    .select("*")
    .eq("project_id", projectId)
    .order("paid_at", { ascending: false })
    .order("created_at", { ascending: false });

  return (data ?? []) as unknown as TeamMemberPayoutRow[];
}
