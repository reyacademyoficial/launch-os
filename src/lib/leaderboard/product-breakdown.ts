import { computeCommission, findApplicableRule } from "@/lib/commissions/calc";
import { buildSaleRanks } from "@/lib/commissions/ranking";
import type {
  CommissionRuleRow,
  PaymentRow,
  SaleRow,
} from "@/lib/commissions/types";
import type { LeadRow } from "@/lib/leads/types";
import type { ProductRow } from "@/lib/products/types";
import type { TeamMemberRow } from "@/lib/team/types";

import type { LeaderboardFilters } from "./aggregate";

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

  const ownerByLead = new Map<string, string | null>(
    leads.map((l) => [l.id, l.team_member_id]),
  );
  const productById = new Map(products.map((p) => [p.id, p]));
  const memberById = new Map(teamMembers.map((m) => [m.id, m]));

  const inDateRange = (closedAt: string): boolean => {
    if (filters.dateFrom && closedAt.slice(0, 10) < filters.dateFrom)
      return false;
    if (filters.dateTo && closedAt.slice(0, 10) > filters.dateTo) return false;
    return true;
  };

  const salesFiltered = sales.filter((s) => {
    if (!inDateRange(s.closed_at)) return false;
    if (filters.launchId && s.launch_id !== filters.launchId) return false;
    return true;
  });

  const paymentsBySale = new Map<string, PaymentRow[]>();
  for (const p of payments) {
    const arr = paymentsBySale.get(p.sale_id);
    if (arr) arr.push(p);
    else paymentsBySale.set(p.sale_id, [p]);
  }

  const rankBySaleId = buildSaleRanks(sales);

  // Bucket = `${owner_id ?? ""}|${product_id}`. Usamos owner_id null para
  // ventas sin closer — se agrupa en fila "Sin asignar".
  interface Acc {
    ownerId: string | null;
    productId: string;
    salesCount: number;
    pledged: number;
    collected: number;
    commission: number;
  }
  const buckets = new Map<string, Acc>();

  for (const s of salesFiltered) {
    const ownerId = ownerByLead.get(s.lead_id) ?? null;
    const productId = s.product_id;
    const key = `${ownerId ?? ""}|${productId}`;
    let acc = buckets.get(key);
    if (!acc) {
      acc = {
        ownerId,
        productId,
        salesCount: 0,
        pledged: 0,
        collected: 0,
        commission: 0,
      };
      buckets.set(key, acc);
    }

    const pays = paymentsBySale.get(s.id) ?? [];
    const rule = findApplicableRule(
      rules,
      s.payment_modality_id,
      s.launch_id,
      s.product_id,
    );
    const breakdown = computeCommission(
      s,
      pays,
      rule,
      rankBySaleId.get(s.id) ?? 0,
    );

    acc.salesCount += 1;
    acc.pledged += Number(s.total_amount) || 0;
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

  // Orden: (vendedor alfabético, con null="Sin asignar" al final)
  // → dentro de cada vendedor, producto alfabético.
  rows.sort((a, b) => {
    const nameA = a.teamMember?.name ?? "￿"; // null va al final
    const nameB = b.teamMember?.name ?? "￿";
    const cmp = nameA.localeCompare(nameB);
    if (cmp !== 0) return cmp;
    return a.product.name.localeCompare(b.product.name);
  });

  return rows;
}
