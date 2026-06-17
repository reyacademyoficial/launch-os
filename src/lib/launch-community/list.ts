import "server-only";

import { createServiceClient } from "@/lib/supabase/service";

import type { LaunchCommunityRow } from "./aggregate";

/**
 * Lee las filas de `launch_community_metrics` de un launch. En la práctica
 * hay 0 o 1 (una por (launch, provider, ventana)). Devolvemos array para
 * que el aggregate pueda manejar el edge case de ventana cambiada (más de
 * una fila histórica con `synced_at` distinto).
 *
 * Va por service-role aunque la tabla tiene RLS de SELECT — la página del
 * lanzamiento ya gateaeó al usuario, y queremos un read consistente con el
 * resto de la página (que también usa service-role).
 *
 * loose() workaround: la tabla se agregó en migration 0029 y el Database
 * type generado todavía no la conoce hasta que se regenere — mismo patrón
 * que sync.ts.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
type LooseClient = { from: (name: string) => any };
function loose(svc: unknown): LooseClient {
  return svc as LooseClient;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function listCommunityMetricsForLaunch(
  launchId: string,
): Promise<LaunchCommunityRow[]> {
  const service = createServiceClient();
  const { data, error } = await loose(service)
    .from("launch_community_metrics")
    .select("entered, removed, clicks, synced_at")
    .eq("launch_id", launchId)
    .order("synced_at", { ascending: false });

  if (error) return [];
  return (data ?? []) as LaunchCommunityRow[];
}
