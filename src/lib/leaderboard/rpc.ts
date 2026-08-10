import "server-only";

import type { CommissionRuleSnapshot } from "@/lib/commissions/types";
import { createClient } from "@/lib/supabase/server";

import type {
  LeaderboardLeadStats,
  LeaderboardSaleStats,
} from "./aggregate";

/**
 * Wrappers para las RPCs de migración 0046. Reemplazan el pull crudo de
 * leads/sales/payments que usaba el leaderboard — pasamos de 3 tablas
 * paginadas (~decenas de round-trips) a 2 llamadas puntuales con la
 * agregación hecha en Postgres.
 *
 * Filtros: launch_id, dateFrom, dateTo se aplican en SQL. El wrapper
 * traduce string vacío → null (equivalente al "sin filtro" en la RPC).
 */

interface RpcLeadStatsRow {
  team_member_id: string | null;
  leads_worked: number | string;
  closed: number | string;
}

interface RpcSaleStatsRow {
  id: string;
  team_member_id: string | null;
  launch_id: string | null;
  product_id: string;
  payment_modality_id: string;
  total_amount: number | string;
  /**
   * Presente desde la migración 0108. Antes de correrla la RPC no la
   * devuelve — el wrapper defaultea 'ARS' abajo (todo lo cerrado histórico
   * fue en pesos, confirmado por el usuario).
   */
  currency?: string | null;
  closed_at: string;
  commission_rule_snapshot: CommissionRuleSnapshot | null;
  sale_rank: number;
  collected: number | string;
  payment_count: number;
}

function toNum(v: number | string): number {
  if (typeof v === "number") return v;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

export async function fetchLeaderboardLeadStats(
  projectId: string,
  launchId: string | null,
): Promise<LeaderboardLeadStats[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "leaderboard_lead_stats" as never,
    { p_project: projectId, p_launch: launchId } as never,
  );
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as RpcLeadStatsRow[];
  return rows.map((r) => ({
    team_member_id: r.team_member_id,
    leads_worked: toNum(r.leads_worked),
    closed: toNum(r.closed),
  }));
}

/**
 * Lee `ghl_pipeline_lead_counts` para un launch y devuelve un Map de
 * `team_member_id → lead_count`. Si un GHL user no tiene mapping, su
 * team_member_id es null (va a la fila "Sin asignar" del ranking).
 * Varios GHL users pueden apuntar al mismo team_member_id — sumamos.
 */
export async function fetchGhlPipelineLeadCounts(
  launchId: string,
): Promise<Map<string | null, number>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ghl_pipeline_lead_counts" as never)
    .select("ghl_user_id, team_member_id, lead_count")
    .eq("launch_id", launchId);

  if (error) throw new Error(error.message);

  const map = new Map<string | null, number>();
  for (const row of ((data ?? []) as Array<{ ghl_user_id: string; team_member_id: string | null; lead_count: number }>)) {
    // Fila centinela legacy (pre-fix): almacenaba el total cuando NINGUNA
    // oportunidad tenía assignedTo. Se sigue saltando por si quedan filas
    // viejas de antes del re-sync. El nuevo sentinel `__unassigned__` pasa
    // como team_member_id=null y cae naturalmente en "Sin asignar".
    if (row.ghl_user_id === "__pipeline_total__") continue;
    const prev = map.get(row.team_member_id) ?? 0;
    map.set(row.team_member_id, prev + row.lead_count);
  }
  return map;
}

export async function fetchLeaderboardSaleStats(
  projectId: string,
  launchId: string | null,
  dateFrom: string | null,
  dateTo: string | null,
): Promise<LeaderboardSaleStats[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "leaderboard_sale_stats" as never,
    {
      p_project: projectId,
      p_launch: launchId,
      p_from: dateFrom,
      p_to: dateTo,
    } as never,
  );
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as RpcSaleStatsRow[];
  return rows.map((r) => ({
    id: r.id,
    team_member_id: r.team_member_id,
    launch_id: r.launch_id,
    product_id: r.product_id,
    payment_modality_id: r.payment_modality_id,
    total_amount: toNum(r.total_amount),
    currency: r.currency === "USD" ? "USD" : "ARS",
    closed_at: r.closed_at,
    commission_rule_snapshot: r.commission_rule_snapshot,
    sale_rank: r.sale_rank,
    collected: toNum(r.collected),
    payment_count: r.payment_count,
  }));
}
