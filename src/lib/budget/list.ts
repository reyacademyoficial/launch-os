import "server-only";

import { createClient } from "@/lib/supabase/server";

import type { BudgetCountryRow, BudgetEntryRow } from "./types";

/**
 * Países del catálogo del proyecto ordenados alfabéticamente. La lista se
 * autogestiona vía addBudgetCountry — no hay seed. RLS filtra por
 * has_project_access antes de que veamos las filas.
 */
export async function listBudgetCountriesForProject(
  projectId: string,
): Promise<BudgetCountryRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("budget_countries")
    .select("id, project_id, name, created_by, created_at")
    .eq("project_id", projectId)
    .order("name", { ascending: true });

  return (data ?? []) as unknown as BudgetCountryRow[];
}

/**
 * Todas las entradas del launch, sin agrupar. El agrupamiento por etapa se
 * hace en el page (barato en TS y evita otro round-trip).
 */
export async function listBudgetEntriesForLaunch(
  launchId: string,
): Promise<BudgetEntryRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("launch_budget_entries")
    .select(
      "id, launch_id, stage, country_id, amount, created_by, created_at, updated_at",
    )
    .eq("launch_id", launchId);

  return (data ?? []) as unknown as BudgetEntryRow[];
}
