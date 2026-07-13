import type { SaleRow } from "./types";

/**
 * Rankea TODAS las ventas del input por bucket (team_member_id, launch_id),
 * ordenado por `closed_at` asc (empate: `created_at` asc). Devuelve un Map
 * sale_id → rank 0-based.
 *
 * Fase 8: el bucket viene de campos propios de la venta (`sale.team_member_id`
 * y `sale.launch_id`), no del lead. Antes usábamos `lead.launch_id` — ahora
 * cada venta tiene atribución de launch propia, así que un mismo lead con
 * ventas en dos launches rankean por separado.
 *
 * Decisiones:
 *   - Las sales sin dueño (team_member_id null) caen en el bucket
 *     `null|launch` — rankean entre ellas para que la fila "Sin asignar"
 *     del LB muestre su comisión teórica con tiers aplicados.
 *   - Las sales sin launch_id (off-books) rankean en el bucket
 *     `owner|null` — como "misceláneo" del closer.
 *   - El ranking se calcula sobre el universo crudo — filtros de fecha o
 *     launch del UI no deben modificar la posición histórica de la venta.
 *     La marginal por tier es propiedad de la venta.
 */
export function buildSaleRanks(
  sales: ReadonlyArray<SaleRow>,
): Map<string, number> {
  const buckets = new Map<string, SaleRow[]>();
  for (const s of sales) {
    const key = `${s.team_member_id ?? ""}|${s.launch_id ?? ""}`;
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
