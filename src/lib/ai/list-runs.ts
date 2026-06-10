import "server-only";

import { createClient } from "@/lib/supabase/server";

import type { AiRunRow } from "./types";

/**
 * Últimas N corridas de análisis IA para un launch. RLS filtra por
 * has_project_access — cualquier miembro lee, ajenos ven [].
 */
export async function listAiRunsForLaunch(
  launchId: string,
  limit = 20,
): Promise<AiRunRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ai_runs")
    .select("*")
    .eq("launch_id", launchId)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data ?? []) as unknown as AiRunRow[];
}

interface ProfileLite {
  id: string;
  full_name: string | null;
}

/**
 * Resuelve full_name de los user_ids de un set de runs. RLS sobre profiles
 * permite leer profile propio + miembros del mismo proyecto (ver 0003), así
 * que un user del mismo project ve quién generó.
 */
export async function fetchRunAuthors(
  runs: ReadonlyArray<AiRunRow>,
): Promise<Map<string, string>> {
  const userIds = Array.from(
    new Set(runs.map((r) => r.user_id).filter((v): v is string => !!v)),
  );
  if (userIds.length === 0) return new Map();

  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", userIds);

  const profiles = (data ?? []) as ProfileLite[];
  return new Map(profiles.map((p) => [p.id, p.full_name ?? "Usuario"]));
}
