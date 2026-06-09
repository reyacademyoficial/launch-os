import "server-only";

import { createClient } from "@/lib/supabase/server";

import type { AdsDailyRow } from "./merge";
import type { LaunchDailyRow } from "./types";

/**
 * Returns all daily entries (manual loads) for a launch, ordered by date
 * ascending so the chart series read left-to-right chronologically. Table
 * view can sort descending in render — pure presentational.
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

/**
 * Trae los rows de ads (sincronizados por el orchestrator) para un launch.
 * Los usamos junto con `listDailyForLaunch` y `mergeDailyData` para alimentar
 * el DailyChart con la vista combinada manual + API.
 *
 * RLS: `launch_daily_ads_select` filtra por `has_project_access`. Stranger
 * obtiene array vacío sin error.
 */
export async function listAdsForLaunch(launchId: string): Promise<AdsDailyRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("launch_daily_ads")
    .select("date, provider, spend, impressions, clicks, leads")
    .eq("launch_id", launchId)
    .order("date", { ascending: true });

  return (data ?? []) as AdsDailyRow[];
}
