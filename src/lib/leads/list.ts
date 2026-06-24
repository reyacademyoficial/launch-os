import "server-only";

import { createClient } from "@/lib/supabase/server";

import type { LeadRow } from "./types";

/**
 * Tamaño de chunk para paginar. Supabase aplica un cap server-side de 1000
 * rows que `.range()` con valores más grandes NO supera (silencioso). La
 * única forma de traer todo es pedir páginas de 1000 hasta agotar.
 */
const LEADS_PAGE_SIZE = 1000;

/**
 * Cap absoluto: si un proyecto supera esto, vamos a switchear a agregación
 * SQL en lugar de pasear 100k+ rows por la red. Funciona como safety net del
 * loop de paginación — nunca debería gatillarse en operación normal.
 */
const LEADS_LIST_HARD_CAP = 100_000;

/**
 * All leads for a project the caller can read. RLS filters cross-tenant
 * silently — un projectId ajeno devuelve [].
 *
 * Orden: nuevos primero (created_at desc) para que la columna "nuevo" del
 * kanban tenga lo último arriba; los buckets de status se forman client-side.
 *
 * Volumen: pagina en chunks de 1000 hasta agotar (Supabase tiene cap
 * server-side de 1000 que `.range(0, 49999)` NO supera). Sin esto los leads
 * viejos quedaban invisibles para el leaderboard (síntoma: total de cerrados
 * en 0 aunque el kanban tenga 48).
 */
export async function listLeads(projectId: string): Promise<LeadRow[]> {
  const supabase = await createClient();
  const out: LeadRow[] = [];
  let from = 0;
  while (from < LEADS_LIST_HARD_CAP) {
    const to = from + LEADS_PAGE_SIZE - 1;
    const { data } = await supabase
      .from("leads")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .range(from, to);
    const rows = (data ?? []) as unknown as LeadRow[];
    if (rows.length === 0) break;
    out.push(...rows);
    if (rows.length < LEADS_PAGE_SIZE) break;
    from += LEADS_PAGE_SIZE;
  }
  return out;
}
