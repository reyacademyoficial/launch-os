import "server-only";

import { createClient } from "@/lib/supabase/server";

import type { LeadRow } from "./types";

/**
 * All leads for a project the caller can read. RLS filters cross-tenant
 * silently — un projectId ajeno devuelve [].
 *
 * Orden: nuevos primero (created_at desc) para que la columna "nuevo" del
 * kanban tenga lo último arriba; los buckets de status se forman client-side.
 */
export async function listLeads(projectId: string): Promise<LeadRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("leads")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  return (data ?? []) as unknown as LeadRow[];
}
