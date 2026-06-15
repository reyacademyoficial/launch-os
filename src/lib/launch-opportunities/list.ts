import "server-only";

import { createClient } from "@/lib/supabase/server";

import {
  aggregateOpportunities,
  EMPTY_SALES_AGGREGATE,
  type LaunchOpportunityRow,
  type SalesAggregate,
} from "./aggregate";

/**
 * Trae las opportunities sincronizadas para un launch. Solo los 3 campos que
 * usa el agregado (status / monetary_value / won_at) — el resto vive en DB
 * como histórico/auditoría pero no entra al KPI cálculo.
 *
 * RLS: `launch_opportunities_select` filtra por
 * `has_project_access(project_of_launch(launch_id))`. Stranger obtiene array
 * vacío sin error, mismo patrón que `listAdsForLaunch`.
 */
export async function listOpportunitiesForLaunch(
  launchId: string,
): Promise<LaunchOpportunityRow[]> {
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const loose = supabase as unknown as { from: (n: string) => any };
  const { data } = await loose
    .from("launch_opportunities")
    .select("status, monetary_value, won_at")
    .eq("launch_id", launchId);

  return (data ?? []) as LaunchOpportunityRow[];
}

/**
 * Trae todas las opportunities del proyecto agrupadas por launch_id en UNA
 * sola query — evita N+1 en el listado del proyecto. Mismo patrón que
 * `listAggregatesForProject` en launch-daily/list.
 *
 * El caller agrega cada bucket aplicando la ventana del launch
 * correspondiente (las fechas no entran a la query — quedan en TS).
 */
export async function listOpportunityRowsByLaunchForProject(
  projectId: string,
): Promise<Map<string, LaunchOpportunityRow[]>> {
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const loose = supabase as unknown as { from: (n: string) => any };
  const { data } = await loose
    .from("launch_opportunities")
    .select("launch_id, status, monetary_value, won_at")
    .eq("project_id", projectId);

  const out = new Map<string, LaunchOpportunityRow[]>();
  for (const r of (data ?? []) as Array<
    LaunchOpportunityRow & { launch_id: string }
  >) {
    const list = out.get(r.launch_id) ?? [];
    list.push({
      status: r.status,
      monetary_value: r.monetary_value,
      won_at: r.won_at,
    });
    out.set(r.launch_id, list);
  }
  return out;
}

/** Reexport para que callers solo importen de list. */
export { EMPTY_SALES_AGGREGATE, aggregateOpportunities };
export type { SalesAggregate };
