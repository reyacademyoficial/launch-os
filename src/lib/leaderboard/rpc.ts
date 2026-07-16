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
    closed_at: r.closed_at,
    commission_rule_snapshot: r.commission_rule_snapshot,
    sale_rank: r.sale_rank,
    collected: toNum(r.collected),
    payment_count: r.payment_count,
  }));
}
