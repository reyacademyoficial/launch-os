import "server-only";

import { createClient } from "@/lib/supabase/server";

import {
  aggregateMergedDaily,
  EMPTY_DAILY_AGGREGATE,
  type DailyAggregate,
} from "./aggregate";
import { mergeDailyData, type AdsDailyRow } from "./merge";
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

/**
 * Trae los agregados (manual ∪ API) para TODOS los launches de un proyecto
 * en 2 queries — para no caer en N+1 cuando el overview/listado del proyecto
 * necesita los KPIs por fila. RLS filtra automáticamente por proyecto del
 * caller; aún así pasamos `project_id` arriba para que el server tenga el
 * filtro como hint.
 *
 * Estrategia: pedimos las dos tablas filtrando por `project_id` (el FK desde
 * `launch_id`), agrupamos en TS por `launch_id`, mergeamos por launch y
 * agregamos. Devuelve un `Map<launchId, DailyAggregate>` con agregado vacío
 * para launches sin daily — el caller decide fallback.
 */
export async function listAggregatesForProject(
  projectId: string,
): Promise<Map<string, DailyAggregate>> {
  const supabase = await createClient();

  // 1 query a launch_daily y 1 query a launch_daily_ads, los dos joinean
  // implícitamente con launches por launch_id (proyectados desde el FK).
  const [dailyRes, adsRes] = await Promise.all([
    supabase
      .from("launch_daily")
      .select("*, launches!inner(project_id)")
      .eq("launches.project_id", projectId)
      .order("date", { ascending: true }),
    supabase
      .from("launch_daily_ads")
      .select(
        "date, provider, spend, impressions, clicks, leads, launch_id, launches!inner(project_id)",
      )
      .eq("launches.project_id", projectId)
      .order("date", { ascending: true }),
  ]);

  const dailyByLaunch = new Map<string, LaunchDailyRow[]>();
  for (const r of (dailyRes.data ?? []) as Array<LaunchDailyRow & { launch_id: string }>) {
    const list = dailyByLaunch.get(r.launch_id) ?? [];
    list.push(r);
    dailyByLaunch.set(r.launch_id, list);
  }

  const adsByLaunch = new Map<string, AdsDailyRow[]>();
  for (const r of (adsRes.data ?? []) as Array<AdsDailyRow & { launch_id: string }>) {
    const list = adsByLaunch.get(r.launch_id) ?? [];
    list.push({
      date: r.date,
      provider: r.provider,
      spend: r.spend,
      impressions: r.impressions,
      clicks: r.clicks,
      leads: r.leads,
    });
    adsByLaunch.set(r.launch_id, list);
  }

  const result = new Map<string, DailyAggregate>();
  const allLaunchIds = new Set<string>([
    ...dailyByLaunch.keys(),
    ...adsByLaunch.keys(),
  ]);
  for (const launchId of allLaunchIds) {
    const merged = mergeDailyData(
      dailyByLaunch.get(launchId) ?? [],
      adsByLaunch.get(launchId) ?? [],
    );
    result.set(launchId, aggregateMergedDaily(merged));
  }
  return result;
}

/** Reexport para callers que solo necesitan el "vacío" sin importar de aggregate.ts. */
export { EMPTY_DAILY_AGGREGATE };
