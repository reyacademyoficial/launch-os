import {
  computeCommissionFromAgg,
  findApplicableRule,
} from "@/lib/commissions/calc";
import { buildSaleRanks } from "@/lib/commissions/ranking";
import type {
  CommissionRuleRow,
  CommissionRuleSnapshot,
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
  /** (closed / leadsWorked) * 100 — porcentaje 0-100. 0 si leadsWorked == 0. */
  conversionRate: number;
  /** Suma de cobros (sum payments.amount) de las ventas que entraron. */
  revenueCollected: number;
  /**
   * Comisiones acumuladas separadas por moneda (0107). Cada tier `fixed`
   * respeta su moneda tal cual — no convertimos. El UI muestra ambas cuando
   * conviven; hoy la operación va en ARS y USD queda en 0 en la práctica.
   */
  commissionAccruedArs: number;
  commissionAccruedUsd: number;
  /**
   * Suma de payouts al miembro — hoy operan en ARS (los liquidamos siempre
   * en pesos). No trackeamos moneda del payout en esta iteración. Cuando el
   * equipo empiece a pagar en USD, agregar `paidOutUsd` + `pendingUsd`.
   */
  paidOut: number;
  /**
   * Saldo a favor del miembro EN ARS: commissionAccruedArs - paidOut. Puede
   * ser negativo (se le pagó más de lo devengado) — no clampeamos.
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
/**
 * Shape pre-agregada que devuelven las RPCs de leaderboard (migración 0046).
 * Reemplaza el pull crudo de leads/sales/payments — para 100k+ leads eso era
 * inviable por PostgREST. Todo el filtrado por launch/período ya vino
 * aplicado desde SQL; el JS solo hace tier walk + suma por miembro.
 */
export interface LeaderboardLeadStats {
  team_member_id: string | null;
  leads_worked: number;
  closed: number;
}

export interface LeaderboardSaleStats {
  id: string;
  team_member_id: string | null;
  launch_id: string | null;
  product_id: string;
  payment_modality_id: string;
  total_amount: number;
  /**
   * Moneda operativa de la venta (`sales.currency`, migración 0106). Se usa
   * para que `computeCommissionFromAgg` derive la moneda de la comisión en
   * tiers `percent`. Default 'ARS' si el wrapper no la trajo (RPC pre-0108
   * o venta legacy).
   */
  currency: "ARS" | "USD";
  closed_at: string;
  commission_rule_snapshot: CommissionRuleSnapshot | null;
  /** Rank 0-based dentro de (team_member_id, launch_id) — ya calculado en SQL. */
  sale_rank: number;
  /** sum(payments.amount) para la venta — ya calculado en SQL. */
  collected: number;
  /** count(payments) para la venta — ya calculado en SQL. */
  payment_count: number;
}

/**
 * Core del leaderboard sobre datos pre-agregados. El pipeline nuevo del page
 * (via RPC) llama directamente esta función. La API vieja `aggregateLeaderboard`
 * es un wrapper que convierte raw → stats en JS y delega acá — así los tests
 * unitarios que arman fixtures de leads/sales/payments siguen valiendo.
 *
 * Filtros: el aggregator ya recibe los stats FILTRADOS. Pero payouts sigue
 * filtrando en JS (tabla chica) y necesitamos `filters` para decidir si
 * agregar la fila "Sin asignar" cuando NO hay leads pero sí hay sales
 * unassigned (o viceversa).
 */
export function aggregateLeaderboardFromStats(input: {
  teamMembers: ReadonlyArray<TeamMemberRow>;
  leadStats: ReadonlyArray<LeaderboardLeadStats>;
  saleStats: ReadonlyArray<LeaderboardSaleStats>;
  rules: ReadonlyArray<CommissionRuleRow>;
  payouts?: ReadonlyArray<TeamMemberPayoutRow>;
  filters: LeaderboardFilters;
}): LeaderboardRow[] {
  const { teamMembers, leadStats, saleStats, rules, filters } = input;
  const payouts = input.payouts ?? [];

  // Index por owner: leadStats y saleStats vienen ya filtrados por launch +
  // período desde la RPC, así que acá solo agrupamos por miembro.
  const leadStatsByMember = new Map<string | null, LeaderboardLeadStats>(
    leadStats.map((s) => [s.team_member_id, s]),
  );
  const saleStatsByOwner = new Map<string | null, LeaderboardSaleStats[]>();
  for (const s of saleStats) {
    const arr = saleStatsByOwner.get(s.team_member_id);
    if (arr) arr.push(s);
    else saleStatsByOwner.set(s.team_member_id, [s]);
  }

  // Payouts filtrados: la RPC no filtra payouts (tabla chica). Mismo criterio
  // que sales — por launch y por rango de `paid_at`.
  const payoutsFiltered = payouts.filter((p) => {
    if (filters.launchId && p.launch_id !== filters.launchId) return false;
    if (filters.dateFrom && p.paid_at < filters.dateFrom) return false;
    if (filters.dateTo && p.paid_at > filters.dateTo) return false;
    return true;
  });

  function buildRow(
    teamMember: TeamMemberRow | null,
    memberId: string | null,
  ): LeaderboardRow {
    const memberLeadStats = leadStatsByMember.get(memberId);
    const memberSales = saleStatsByOwner.get(memberId) ?? [];

    let revenueCollected = 0;
    let commissionAccruedArs = 0;
    let commissionAccruedUsd = 0;
    for (const sale of memberSales) {
      // Cascada Fase 7 — sólo se usa como fallback si la venta no tiene
      // snapshot congelado (el 99% lo tiene).
      const rule = findApplicableRule(
        rules,
        sale.payment_modality_id,
        sale.launch_id,
        sale.product_id,
      );
      // TODO(mixed-currency): `sale.collected` viene de la RPC
      // `leaderboard_sale_stats` sumando `payments.amount` crudo, sin FX ni
      // consulta a `payments.original_currency`. Si un miembro tiene ventas
      // mixed-currency (sale ARS + cobros USD o viceversa) `collected` está
      // en unidades cruzadas y el ratio collected/pledged que usa el calc
      // devuelve basura para thresholds paid_ratio o tiers fixed. Fix
      // requiere reescribir el RPC para sumar `original_amount * fx_rate`
      // (o `amount_usd` pre-normalizado) — fuera de scope de este bug fix.
      const breakdown = computeCommissionFromAgg(
        {
          total_amount: sale.total_amount,
          commission_rule_snapshot: sale.commission_rule_snapshot,
          currency: sale.currency,
        },
        { collected: sale.collected, paymentCount: sale.payment_count },
        rule,
        sale.sale_rank,
      );
      revenueCollected += breakdown.collected;
      if (breakdown.commissionCurrency === "USD") {
        commissionAccruedUsd += breakdown.commission;
      } else {
        commissionAccruedArs += breakdown.commission;
      }
    }

    const paidOut = memberId
      ? payoutsFiltered
          .filter((p) => p.team_member_id === memberId)
          .reduce((sum, p) => sum + Number(p.amount), 0)
      : 0;

    const leadsWorked = memberLeadStats?.leads_worked ?? 0;
    const closed = memberLeadStats?.closed ?? 0;
    const conversionRate =
      leadsWorked === 0 ? 0 : (closed / leadsWorked) * 100;

    return {
      teamMember,
      leadsWorked,
      closed,
      conversionRate,
      revenueCollected,
      commissionAccruedArs,
      commissionAccruedUsd,
      paidOut,
      // Pendiente vs. payouts se calcula sobre la base ARS (hoy los payouts
      // operan siempre en pesos). Si aparecen comisiones USD sin USD-payouts
      // ese saldo no se refleja acá — el UI lo muestra aparte para que el
      // admin sepa que hay algo por liquidar.
      pending: commissionAccruedArs - paidOut,
    };
  }

  const rows: LeaderboardRow[] = teamMembers.map((tm) => buildRow(tm, tm.id));

  const hasUnassignedLeads = leadStatsByMember.has(null);
  const hasUnassignedSales = (saleStatsByOwner.get(null)?.length ?? 0) > 0;
  if (hasUnassignedLeads || hasUnassignedSales) {
    rows.push(buildRow(null, null));
  }

  return rows;
}

/**
 * Wrapper legacy que acepta raw leads/sales/payments (tests + callers que
 * arman todo el fixture en memoria). Convierte a la shape pre-agregada
 * aplicando los mismos filtros que hacía la RPC 0046, y delega en el core.
 * La agregación in-JS que hace acá es idéntica al SQL — cualquier cambio de
 * política se toca en un lugar (el core).
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

  const inDateRange = (closedAt: string): boolean => {
    if (filters.dateFrom && closedAt.slice(0, 10) < filters.dateFrom) return false;
    if (filters.dateTo && closedAt.slice(0, 10) > filters.dateTo) return false;
    return true;
  };

  // leadStats — GROUP BY team_member_id, filter por launch (nunca por fecha).
  const leadsFiltered = filters.launchId
    ? leads.filter((l) => l.launch_id === filters.launchId)
    : leads;
  const leadStatsAcc = new Map<
    string | null,
    { leads_worked: number; closed: number }
  >();
  for (const l of leadsFiltered) {
    const acc = leadStatsAcc.get(l.team_member_id) ?? {
      leads_worked: 0,
      closed: 0,
    };
    acc.leads_worked += 1;
    if (l.status === "cerrado") acc.closed += 1;
    leadStatsAcc.set(l.team_member_id, acc);
  }
  const leadStats: LeaderboardLeadStats[] = Array.from(leadStatsAcc, ([id, v]) => ({
    team_member_id: id,
    leads_worked: v.leads_worked,
    closed: v.closed,
  }));

  // saleStats — filter por launch + período, join payments + rank.
  const rankBySaleId = buildSaleRanks(sales);
  const paymentsBySale = new Map<string, PaymentRow[]>();
  for (const p of payments) {
    const arr = paymentsBySale.get(p.sale_id);
    if (arr) arr.push(p);
    else paymentsBySale.set(p.sale_id, [p]);
  }

  // Atribución legacy: la venta se imputa al DUEÑO DEL LEAD, no a
  // sale.team_member_id (que es denorm y puede divergir en fixtures de
  // tests). El path RPC usa sale.team_member_id porque el invariante DB
  // lo garantiza; acá replicamos lo que hacía el aggregador viejo.
  const ownerByLead = new Map<string, string | null>(
    leads.map((l) => [l.id, l.team_member_id]),
  );

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
      currency: s.currency === "USD" ? "USD" : "ARS",
      closed_at: s.closed_at,
      commission_rule_snapshot: s.commission_rule_snapshot,
      sale_rank: rankBySaleId.get(s.id) ?? 0,
      collected,
      payment_count: pays.length,
    });
  }

  return aggregateLeaderboardFromStats({
    teamMembers,
    leadStats,
    saleStats,
    rules,
    payouts: input.payouts,
    filters,
  });
}
