import {
  computeCommissionFromAgg,
  findApplicableRule,
} from "@/lib/commissions/calc";
import { buildSaleRanks } from "@/lib/commissions/ranking";
import type {
  CommissionRuleRow,
  PaymentRow,
  SaleRow,
} from "@/lib/commissions/types";
import type { LeadRow } from "@/lib/leads/types";
import type { ProductRow } from "@/lib/products/types";
import type { TeamMemberRow } from "@/lib/team/types";

import type {
  LeaderboardFilters,
  LeaderboardSaleStats,
} from "./aggregate";

/**
 * Una fila = una combinación (vendedor, producto). Si el mismo vendedor
 * vendió 3 productos distintos, aparece en 3 filas separadas. Ventas sin
 * vendedor asignado caen en la fila con `teamMember: null` (mismo criterio
 * que el leaderboard principal).
 *
 * `commissionAccrued` deriva de `computeCommission` con la misma cascada
 * de reglas que el leaderboard — snapshot congelado prevalece si existe.
 */
export interface ProductBreakdownRow {
  teamMember: TeamMemberRow | null;
  product: ProductRow;
  salesCount: number;
  pledged: number;
  collected: number;
  commissionAccrued: number;
}

/**
 * Agrupa las ventas del universo filtrado por (vendedor, producto). Usa
 * exactamente el mismo criterio de filtrado que `aggregateLeaderboard` para
 * que los totales cuadren:
 *   - filter por `sale.launch_id` cuando hay filtro de launch (Fase 8).
 *   - filter por `sale.closed_at` en el rango de fechas.
 *   - atribución de vendedor por `lead.team_member_id` (fuente única).
 *
 * El ranking para tiers se calcula sobre TODAS las ventas del proyecto, no
 * las filtradas — mismo criterio que el leaderboard: el filtro de UI no
 * debe correr el tier histórico de una venta.
 */
/**
 * Core sobre stats pre-agregados (idem que `aggregateLeaderboardFromStats`).
 * El path RPC del leaderboard reutiliza el mismo `saleStats` para el
 * breakdown por producto — evita re-fetch.
 */
export function aggregateProductBreakdownFromStats(input: {
  teamMembers: ReadonlyArray<TeamMemberRow>;
  saleStats: ReadonlyArray<LeaderboardSaleStats>;
  rules: ReadonlyArray<CommissionRuleRow>;
  products: ReadonlyArray<ProductRow>;
}): ProductBreakdownRow[] {
  const { teamMembers, saleStats, rules, products } = input;

  const productById = new Map(products.map((p) => [p.id, p]));
  const memberById = new Map(teamMembers.map((m) => [m.id, m]));

  interface Acc {
    ownerId: string | null;
    productId: string;
    salesCount: number;
    pledged: number;
    collected: number;
    commission: number;
  }
  const buckets = new Map<string, Acc>();

  for (const s of saleStats) {
    const key = `${s.team_member_id ?? ""}|${s.product_id}`;
    let acc = buckets.get(key);
    if (!acc) {
      acc = {
        ownerId: s.team_member_id,
        productId: s.product_id,
        salesCount: 0,
        pledged: 0,
        collected: 0,
        commission: 0,
      };
      buckets.set(key, acc);
    }

    const rule = findApplicableRule(
      rules,
      s.payment_modality_id,
      s.launch_id,
      s.product_id,
    );
    const breakdown = computeCommissionFromAgg(
      {
        total_amount: s.total_amount,
        commission_rule_snapshot: s.commission_rule_snapshot,
      },
      { collected: s.collected, paymentCount: s.payment_count },
      rule,
      s.sale_rank,
    );

    acc.salesCount += 1;
    acc.pledged += s.total_amount;
    acc.collected += breakdown.collected;
    acc.commission += breakdown.commission;
  }

  const rows: ProductBreakdownRow[] = [];
  for (const acc of buckets.values()) {
    const product = productById.get(acc.productId);
    if (!product) continue; // producto borrado — no debería pasar por FK restrict.
    const teamMember = acc.ownerId ? memberById.get(acc.ownerId) ?? null : null;
    rows.push({
      teamMember,
      product,
      salesCount: acc.salesCount,
      pledged: acc.pledged,
      collected: acc.collected,
      commissionAccrued: acc.commission,
    });
  }

  rows.sort((a, b) => {
    const nameA = a.teamMember?.name ?? "￿"; // null va al final
    const nameB = b.teamMember?.name ?? "￿";
    const cmp = nameA.localeCompare(nameB);
    if (cmp !== 0) return cmp;
    return a.product.name.localeCompare(b.product.name);
  });

  return rows;
}

/**
 * Wrapper legacy — mismo criterio de compat que `aggregateLeaderboard`.
 * Convierte raw leads/sales/payments a la shape pre-agregada y delega en el
 * core. Preserva la atribución legacy vía `lead.team_member_id` (no
 * `sale.team_member_id`) para fixtures de tests con divergencia intencional.
 */
export function aggregateProductBreakdown(input: {
  teamMembers: ReadonlyArray<TeamMemberRow>;
  leads: ReadonlyArray<LeadRow>;
  sales: ReadonlyArray<SaleRow>;
  payments: ReadonlyArray<PaymentRow>;
  rules: ReadonlyArray<CommissionRuleRow>;
  products: ReadonlyArray<ProductRow>;
  filters: LeaderboardFilters;
}): ProductBreakdownRow[] {
  const { teamMembers, leads, sales, payments, rules, products, filters } =
    input;

  const inDateRange = (closedAt: string): boolean => {
    if (filters.dateFrom && closedAt.slice(0, 10) < filters.dateFrom)
      return false;
    if (filters.dateTo && closedAt.slice(0, 10) > filters.dateTo) return false;
    return true;
  };

  const ownerByLead = new Map<string, string | null>(
    leads.map((l) => [l.id, l.team_member_id]),
  );
  const rankBySaleId = buildSaleRanks(sales);
  const paymentsBySale = new Map<string, PaymentRow[]>();
  for (const p of payments) {
    const arr = paymentsBySale.get(p.sale_id);
    if (arr) arr.push(p);
    else paymentsBySale.set(p.sale_id, [p]);
  }

  const saleStats: LeaderboardSaleStats[] = [];
  for (const s of sales) {
    if (!inDateRange(s.closed_at)) continue;
    if (filters.launchId && s.launch_id !== filters.launchId) continue;
    const pays = paymentsBySale.get(s.id) ?? [];
    const collected = pays.reduce(
      (acc, p) => acc + Number(p.amount || 0),
      0,
    );
    saleStats.push({
      id: s.id,
      team_member_id: ownerByLead.get(s.lead_id) ?? null,
      launch_id: s.launch_id,
      product_id: s.product_id,
      payment_modality_id: s.payment_modality_id,
      total_amount: Number(s.total_amount) || 0,
      closed_at: s.closed_at,
      commission_rule_snapshot: s.commission_rule_snapshot,
      sale_rank: rankBySaleId.get(s.id) ?? 0,
      collected,
      payment_count: pays.length,
    });
  }

  return aggregateProductBreakdownFromStats({
    teamMembers,
    saleStats,
    rules,
    products,
  });
}
