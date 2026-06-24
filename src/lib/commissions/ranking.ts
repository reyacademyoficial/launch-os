import type { LeadRow } from "@/lib/leads/types";

import type { SaleRow } from "./types";

/**
 * Rankea TODAS las ventas del input por bucket (dueño_del_lead, launch_of_lead),
 * ordenado por `closed_at` asc (empate: `created_at` asc). Devuelve un Map
 * sale_id → rank 0-based.
 *
 * Decisiones:
 *   - El dueño Y el launch del bucket vienen del LEAD. La venta tiene su
 *     propio `team_member_id` denormalizado, pero NO es fuente de verdad.
 *     El Leaderboard y el PDF de comisiones agrupan por dueño del lead;
 *     este ranking matchea esa partición.
 *   - Las sales cuyo lead no tiene dueño asignado caen en el bucket
 *     `null|launch_of_lead` — rankean entre ellas para que la fila
 *     "Sin asignar" del LB muestre su comisión teórica con tiers aplicados.
 *   - El ranking se calcula sobre el universo crudo de ventas — filtros de
 *     fecha o launch del UI no deben modificar la posición histórica de la
 *     venta. La marginal por tier es propiedad de la venta, no del filtro.
 */
export function buildSaleRanks(
  sales: ReadonlyArray<SaleRow>,
  leads: ReadonlyArray<Pick<LeadRow, "id" | "team_member_id" | "launch_id">>,
): Map<string, number> {
  return buildSaleRanksFromLaunchMap(sales, leads);
}

/**
 * Variante con la misma firma — antes existía un overload que tomaba
 * `Map<lead_id, launch_id>`, pero el bucket ahora necesita también el dueño
 * del lead, así que recibir `leads` directo es más simple y honesto.
 */
export function buildSaleRanksFromLaunchMap(
  sales: ReadonlyArray<SaleRow>,
  leads: ReadonlyArray<Pick<LeadRow, "id" | "team_member_id" | "launch_id">>,
): Map<string, number> {
  const ownerByLead = new Map<string, string | null>(
    leads.map((l) => [l.id, l.team_member_id]),
  );
  const launchByLead = new Map<string, string | null>(
    leads.map((l) => [l.id, l.launch_id]),
  );

  const buckets = new Map<string, SaleRow[]>();
  for (const s of sales) {
    const owner = ownerByLead.get(s.lead_id) ?? null;
    const launch = launchByLead.get(s.lead_id) ?? null;
    const key = `${owner ?? ""}|${launch ?? ""}`;
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
