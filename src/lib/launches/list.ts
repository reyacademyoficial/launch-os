import "server-only";

import { createClient } from "@/lib/supabase/server";

import type { LaunchRow } from "./types";

/**
 * Returns all launches for a project the caller can read, newest first.
 *
 * RLS (`launches_select`) restricts results to projects the user has access
 * to — passing a stranger's projectId returns an empty array, never errors.
 */
export async function listLaunchesForProject(projectId: string): Promise<LaunchRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("launches")
    .select("*")
    .eq("project_id", projectId)
    .order("date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  return (data ?? []) as LaunchRow[];
}
