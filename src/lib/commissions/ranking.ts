import type { LeadRow } from "@/lib/leads/types";

import type { SaleRow } from "./types";

/**
 * Rankea TODAS las ventas del input por bucket (team_member, launch_of_lead),
 * ordenado por `closed_at` asc (empate: `created_at` asc). Devuelve un Map
 * sale_id → rank 0-based.
 *
 * Decisiones:
 *   - El launch del bucket viene del LEAD (las sales no guardan launch).
 *   - Ventas sin team_member NO entran al ranking (no se imputan a nadie).
 *   - El ranking se calcula sobre el universo crudo de ventas — filtros de
 *     fecha o launch del UI no deben modificar la posición histórica de la
 *     venta. La marginal por tier es propiedad de la venta, no del filtro.
 */
export function buildSaleRanks(
  sales: ReadonlyArray<SaleRow>,
  leads: ReadonlyArray<Pick<LeadRow, "id" | "launch_id">>,
): Map<string, number> {
  const launchByLead = new Map<string, string | null>(
    leads.map((l) => [l.id, l.launch_id]),
  );
  return buildSaleRanksFromLaunchMap(sales, launchByLead);
}

/** Variante para call sites que ya armaron el map lead→launch. */
export function buildSaleRanksFromLaunchMap(
  sales: ReadonlyArray<SaleRow>,
  launchByLead: Map<string, string | null>,
): Map<string, number> {
  const buckets = new Map<string, SaleRow[]>();
  for (const s of sales) {
    if (!s.team_member_id) continue;
    const launchOfLead = launchByLead.get(s.lead_id) ?? null;
    const key = `${s.team_member_id}|${launchOfLead ?? ""}`;
    const arr = buckets.get(key);
    if (arr) arr.push(s);
    else buckets.set(key, [s]);
  }

  const rankBySaleId = new Map<string, number>();
  for (const arr of buckets.values()) {
    arr.sort((a, b) => {
      const cmp = a.closed_at.localeCompare(b.closed_at);
      if (cmp !== 0) return cmp;
      return a.created_at.localeCompare(b.created_at);
    });
    arr.forEach((s, i) => rankBySaleId.set(s.id, i));
  }
  return rankBySaleId;
}
