import "server-only";

import { createClient } from "@/lib/supabase/server";

import type { LaunchDailyRow } from "./types";

/**
 * Returns all daily entries for a launch, ordered by date ascending so the
 * chart series read left-to-right chronologically. Table view can sort
 * descending in render — pure presentational.
 *
 * RLS (`launch_daily_select`) filters via `project_of_launch(launch_id)` so
 * a stranger gets an empty array, never an error.
 */
export async function listDailyForLaunch(launchId: string): Promise<LaunchDailyRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("launch_daily")
    .select("*")
    .eq("launch_id", launchId)
    .order("date", { ascending: true });

  return (data ?? []) as LaunchDailyRow[];
}
