import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * Funnel de conversión 3 etapas (decisión 8b): Lead → Agendado → Vendido.
 *
 *   - Lead       = leads del scope (sin filtro de status).
 *   - Agendado   = status ∈ {agendado, cerrado}. "cerrado" implica que pasó por
 *                  agendado en algún momento — el funnel suma, no es discreto.
 *   - Vendido    = status = cerrado AND existe sale asociada. Pedimos sale
 *                  explícita para no contar "cerrado manual sin venta cargada".
 *
 * Todo server-side: 3 counts con filtros distintos sobre `leads` (más el
 * EXISTS sobre sales para vendido). Postgres lo resuelve con index seek
 * (leads_project_status_idx existe desde 0013).
 *
 * Scope:
 *   - Si `launchIds` es null o vacío, cuenta sobre TODOS los leads del
 *     proyecto.
 *   - Si tiene UUIDs, filtra por `launch_id IN (...)`. Leads sin launch_id
 *     no entran al scope cuando hay filtro activo — coherente con el
 *     comparador (un launch a comparar implica scope per-launch).
 */

export interface FunnelStage {
  /** Identificador estable para el chart. */
  key: "lead" | "agendado" | "vendido";
  label: string;
  count: number;
  /**
   * Porcentaje del paso anterior. La etapa "lead" lo deja en 100 por
   * definición; las siguientes muestran la tasa de conversión vs la
   * etapa previa.
   */
  rateOfPrev: number;
}

export interface FunnelData {
  stages: FunnelStage[];
}

export async function getFunnelData(args: {
  projectId: string;
  launchIds: ReadonlyArray<string> | null;
}): Promise<FunnelData> {
  const supabase = await createClient();

  // Cada count es una query independiente con `head: true` (no trae filas,
  // solo el count). Las 3 corren en paralelo.
  const [leadCount, agendadoCount, vendidoCount] = await Promise.all([
    countLeads(supabase, args, null),
    countLeads(supabase, args, ["agendado", "cerrado"]),
    countSoldLeads(supabase, args),
  ]);

  const stages: FunnelStage[] = [
    { key: "lead", label: "Lead", count: leadCount, rateOfPrev: 100 },
    {
      key: "agendado",
      label: "Agendado",
      count: agendadoCount,
      rateOfPrev: leadCount > 0 ? (agendadoCount / leadCount) * 100 : 0,
    },
    {
      key: "vendido",
      label: "Vendido",
      count: vendidoCount,
      rateOfPrev:
        agendadoCount > 0 ? (vendidoCount / agendadoCount) * 100 : 0,
    },
  ];

  return { stages };
}

type Sb = Awaited<ReturnType<typeof createClient>>;

async function countLeads(
  supabase: Sb,
  args: { projectId: string; launchIds: ReadonlyArray<string> | null },
  statuses: ReadonlyArray<string> | null,
): Promise<number> {
  let q = supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("project_id", args.projectId);
  if (args.launchIds && args.launchIds.length > 0) {
    q = q.in("launch_id", args.launchIds as string[]);
  }
  if (statuses) q = q.in("status", statuses as string[]);
  const { count } = await q;
  return count ?? 0;
}

async function countSoldLeads(
  supabase: Sb,
  args: { projectId: string; launchIds: ReadonlyArray<string> | null },
): Promise<number> {
  // Vendido = lead.status='cerrado' AND existe sale asociada. Usamos inner
  // join a sales — sale.lead_id UNIQUE (0014) garantiza no double-count.
  let q = supabase
    .from("leads")
    .select("id, sales!inner(id)", { count: "exact", head: true })
    .eq("project_id", args.projectId)
    .eq("status", "cerrado");
  if (args.launchIds && args.launchIds.length > 0) {
    q = q.in("launch_id", args.launchIds as string[]);
  }
  const { count } = await q;
  return count ?? 0;
}
