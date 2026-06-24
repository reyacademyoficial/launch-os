import { computeCommission, findApplicableRule } from "@/lib/commissions/calc";
import { buildSaleRanksFromLaunchMap } from "@/lib/commissions/ranking";
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
  /** Null indica la fila agregada "Sin asignar" (lead.team_member_id IS NULL). */
  teamMember: TeamMemberRow | null;
  /** Leads asignados al miembro (filtrados por launch si aplica). */
  leadsWorked: number;
  /** Leads del miembro con `status='cerrado'` (alineado con el Kanban). */
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
 * ATRIBUCIÓN — fuente única de verdad: `lead.team_member_id`.
 *   El Kanban agrupa por dueño del lead (status='cerrado' dentro de la columna
 *   del setter), así que el Leaderboard hace lo mismo. `sale.team_member_id`
 *   queda como denormalización mantenida por `createSale` + `updateLead`, pero
 *   este agregador no la mira.
 *
 * CERRADOS — definición fijada: cantidad de `leads.status='cerrado'` del
 *   miembro. NO contamos filas de `sales`. Esto matchea el Kanban exacto y
 *   cubre el caso "lead cerrado manualmente sin abrir la venta".
 *
 * SIN ASIGNAR — fila extra con `teamMember: null` cuando hay leads/sales con
 *   `lead.team_member_id IS NULL`. Es read-only en la UI (sin payouts) pero
 *   suma al total del header — antes del fix esos $11.62M eran invisibles.
 *
 * RANK PARA TIERS — importante:
 *   El tier marginal se elige por la posición 0-based de la venta dentro
 *   del bucket (dueño_del_lead, launch_of_lead), ordenado por `closed_at`
 *   asc (empate: `created_at` asc). El ranking se calcula sobre TODAS las
 *   ventas del proyecto, NO sobre las filtradas — el filtro de fecha
 *   esconde ventas del resumen, pero la posición histórica de cada venta
 *   no cambia. Lo mismo si se filtra por launch: el bucket sigue siendo
 *   (dueño_del_lead, launch_of_lead).
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
  // Index lead → owner (team_member_id). Atribución autoritativa.
  const ownerByLead = new Map<string, string | null>(
    leads.map((l) => [l.id, l.team_member_id]),
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

  // 4) Rank por venta dentro de (dueño_del_lead, launch). Se calcula sobre
  //    TODAS las ventas (no las filtradas) — un filtro de UI no debe correr
  //    el tier histórico.
  const rankBySaleId = buildSaleRanksFromLaunchMap(sales, leads);

  // 5) Filtrar payouts. Mismo criterio que sales: respeta launchId y rango de
  //    fechas, pero acá la fecha es `paid_at` (date) — la pregunta es "qué le
  //    pagué en este período", paralela a "qué se cerró en este período".
  const payoutsFiltered = payouts.filter((p) => {
    if (filters.launchId && p.launch_id !== filters.launchId) return false;
    if (filters.dateFrom && p.paid_at < filters.dateFrom) return false;
    if (filters.dateTo && p.paid_at > filters.dateTo) return false;
    return true;
  });

  // Pre-cálculo: agrupar sales por dueño del lead una sola vez (más barato y
  // legible que filtrar dentro del loop de miembros).
  const salesByOwner = new Map<string | null, SaleRow[]>();
  for (const s of salesFiltered) {
    const owner = ownerByLead.get(s.lead_id) ?? null;
    const arr = salesByOwner.get(owner);
    if (arr) arr.push(s);
    else salesByOwner.set(owner, [s]);
  }

  function buildRow(
    teamMember: TeamMemberRow | null,
    memberId: string | null,
  ): LeaderboardRow {
    const memberLeads = leadsFiltered.filter((l) => l.team_member_id === memberId);
    const memberSales = salesByOwner.get(memberId) ?? [];

    let revenueCollected = 0;
    let commissionAccrued = 0;
    for (const sale of memberSales) {
      const pays = paymentsBySale.get(sale.id) ?? [];
      const launchOfLead = launchByLead.get(sale.lead_id) ?? null;
      const rule = findApplicableRule(rules, sale.payment_modality_id, launchOfLead);
      const saleRank = rankBySaleId.get(sale.id) ?? 0;
      const breakdown = computeCommission(sale, pays, rule, saleRank);
      revenueCollected += breakdown.collected;
      commissionAccrued += breakdown.commission;
    }

    const paidOut = memberId
      ? payoutsFiltered
          .filter((p) => p.team_member_id === memberId)
          .reduce((sum, p) => sum + Number(p.amount), 0)
      : 0;

    const closed = memberLeads.filter((l) => l.status === "cerrado").length;
    const conversionRate =
      memberLeads.length === 0 ? 0 : closed / memberLeads.length;

    return {
      teamMember,
      leadsWorked: memberLeads.length,
      closed,
      conversionRate,
      revenueCollected,
      commissionAccrued,
      paidOut,
      pending: commissionAccrued - paidOut,
    };
  }

  const rows: LeaderboardRow[] = teamMembers.map((tm) => buildRow(tm, tm.id));

  // Fila "Sin asignar" — solo si hay algo que mostrar (leads sin dueño O
  // sales sobre leads sin dueño en el período/launch filtrado).
  const hasUnassignedLeads = leadsFiltered.some((l) => l.team_member_id === null);
  const hasUnassignedSales = (salesByOwner.get(null)?.length ?? 0) > 0;
  if (hasUnassignedLeads || hasUnassignedSales) {
    rows.push(buildRow(null, null));
  }

  return rows;
}
