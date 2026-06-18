import { computeCommission, findApplicableRule } from "@/lib/commissions/calc";
import type {
  CommissionRuleRow,
  PaymentRow,
  SaleRow,
} from "@/lib/commissions/types";
import type { LeadRow } from "@/lib/leads/types";
import type { TeamMemberPayoutRow } from "@/lib/payouts/types";
import type { TeamMemberRow } from "@/lib/team/types";

/**
 * Filtros opcionales del leaderboard.
 *
 *   - launchId: limita leads (.launch_id == X) y ventas heredan vía el lead.
 *     Si está vacío → sin filtro de launch.
 *   - dateFrom / dateTo: rango (inclusive) sobre `sales.closed_at`. Decisión:
 *     todo el cálculo del período se basa en cuándo se cerró la venta, no en
 *     cuándo entró el cobro. "Ventas cerradas en X período".
 *
 * Si los filtros están todos vacíos → leaderboard del proyecto entero, todas
 * las épocas.
 */
export interface LeaderboardFilters {
  launchId?: string | null;
  dateFrom?: string | null; // YYYY-MM-DD
  dateTo?: string | null;
}

export interface LeaderboardRow {
  teamMember: TeamMemberRow;
  /** Leads asignados al miembro (filtrados por launch si aplica). */
  leadsWorked: number;
  /** Ventas cerradas (en el período si aplica) del miembro. */
  closed: number;
  /** closed / leadsWorked. 0 si leadsWorked == 0. */
  conversionRate: number;
  /** Suma de cobros (sum payments.amount) de las ventas que entraron. */
  revenueCollected: number;
  /** Suma de comisión derivada por venta — derivada en cada lectura. */
  commissionAccrued: number;
  /** Suma de payouts al miembro (respetando filtros launch + período). */
  paidOut: number;
  /**
   * Saldo a favor del miembro: commissionAccrued - paidOut. Puede ser negativo
   * (se le pagó más de lo devengado) — no clampeamos para que el admin lo vea.
   */
  pending: number;
}

/**
 * Cálculo en memoria. La función es pura — alimentar con las listas crudas
 * que vienen de la DB. La idea es que el page haga el fetch y delegue acá
 * para no atar lógica de agregación a la capa de IO.
 *
 * Comisión: usa `findApplicableRule` + `computeCommission` (de
 * lib/commissions/calc). Una sale sin regla suma 0 a la comisión. Idem
 * `team_member_id == null` (venta sin closer asignado) → no se imputa a
 * nadie y queda excluida del leaderboard por miembro.
 */
export function aggregateLeaderboard(input: {
  teamMembers: ReadonlyArray<TeamMemberRow>;
  leads: ReadonlyArray<LeadRow>;
  sales: ReadonlyArray<SaleRow>;
  payments: ReadonlyArray<PaymentRow>;
  rules: ReadonlyArray<CommissionRuleRow>;
  payouts?: ReadonlyArray<TeamMemberPayoutRow>;
  filters: LeaderboardFilters;
}): LeaderboardRow[] {
  const { teamMembers, leads, sales, payments, rules, filters } = input;
  const payouts = input.payouts ?? [];

  // 1) Filtrar leads por launch (si hay filtro). El filtro de período no
  //    aplica a leads (no se filtra "trabajados" por fecha).
  const leadsFiltered = filters.launchId
    ? leads.filter((l) => l.launch_id === filters.launchId)
    : leads;

  // Index lead → launch_id, para resolver la regla aplicable a la venta.
  const launchByLead = new Map<string, string | null>(
    leads.map((l) => [l.id, l.launch_id]),
  );

  // 2) Filtrar sales por launch (vía lead.launch_id) y por período
  //    (sales.closed_at en rango).
  const inDateRange = (closedAt: string): boolean => {
    if (filters.dateFrom && closedAt.slice(0, 10) < filters.dateFrom) return false;
    if (filters.dateTo && closedAt.slice(0, 10) > filters.dateTo) return false;
    return true;
  };

  const salesFiltered = sales.filter((s) => {
    if (!inDateRange(s.closed_at)) return false;
    if (filters.launchId) {
      const launchId = launchByLead.get(s.lead_id);
      if (launchId !== filters.launchId) return false;
    }
    return true;
  });

  // 3) Index payments por sale_id.
  const paymentsBySale = new Map<string, PaymentRow[]>();
  for (const p of payments) {
    const arr = paymentsBySale.get(p.sale_id);
    if (arr) arr.push(p);
    else paymentsBySale.set(p.sale_id, [p]);
  }

  // 4) Filtrar payouts. Mismo criterio que sales: respeta launchId y rango de
  //    fechas, pero acá la fecha es `paid_at` (date) — la pregunta es "qué le
  //    pagué en este período", paralela a "qué se cerró en este período".
  const payoutsFiltered = payouts.filter((p) => {
    if (filters.launchId && p.launch_id !== filters.launchId) return false;
    if (filters.dateFrom && p.paid_at < filters.dateFrom) return false;
    if (filters.dateTo && p.paid_at > filters.dateTo) return false;
    return true;
  });

  // 5) Por team_member: contar leads, contar sales, sumar revenue + comisión.
  const rows: LeaderboardRow[] = teamMembers.map((tm) => {
    const memberLeads = leadsFiltered.filter((l) => l.team_member_id === tm.id);
    const memberSales = salesFiltered.filter((s) => s.team_member_id === tm.id);

    let revenueCollected = 0;
    let commissionAccrued = 0;
    for (const sale of memberSales) {
      const pays = paymentsBySale.get(sale.id) ?? [];
      const launchOfLead = launchByLead.get(sale.lead_id) ?? null;
      const rule = findApplicableRule(rules, sale.payment_modality_id, launchOfLead);
      const breakdown = computeCommission(sale, pays, rule);
      revenueCollected += breakdown.collected;
      commissionAccrued += breakdown.commission;
    }

    const paidOut = payoutsFiltered
      .filter((p) => p.team_member_id === tm.id)
      .reduce((sum, p) => sum + Number(p.amount), 0);

    const conversionRate =
      memberLeads.length === 0 ? 0 : memberSales.length / memberLeads.length;

    return {
      teamMember: tm,
      leadsWorked: memberLeads.length,
      closed: memberSales.length,
      conversionRate,
      revenueCollected,
      commissionAccrued,
      paidOut,
      pending: commissionAccrued - paidOut,
    };
  });

  return rows;
}
