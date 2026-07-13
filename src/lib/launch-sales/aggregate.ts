/**
 * Agregado puro de `sales + payments` filtrado por leads en columna `cerrado`
 * del launch. Reemplaza el rol que tenía `launch-opportunities/aggregate` en
 * el cálculo del KPI revenue.
 *
 * Reglas:
 *   - Una `sale` cuenta solo si el `lead` está en status='cerrado' y pertenece
 *     al launch (decisión 2.a). Ventas registradas en leads `tibio`, `frio`,
 *     etc. quedan fuera del KPI revenue — siguen en DB para comisiones e
 *     histórico, pero no entran a este agregado.
 *   - `pledgedRevenue` = Σ sale.total_amount (lo pactado por el cliente).
 *   - `collectedRevenue` = Σ payments.amount de esas ventas (lo efectivamente
 *     cobrado).
 *   - `hasData = salesCount > 0`. Si el kanban no tiene ventas cerradas, el
 *     KPI cae completo al manual (revenue_estimated_manual /
 *     revenue_collected_manual del form del launch). Si tiene aunque sea 1,
 *     el manual se SUMA (decisión 3.b — comportamiento "sumable", no
 *     "fallback").
 *
 * NOTA importante sobre el modo de combinación: a diferencia de
 * `aggregateOpportunities` (que era estricto "agregado o manual, nunca
 * mezclados"), acá el caller suma kanban + manual siempre. El campo
 * `hasData` queda como señal para la UI (mostrar/ocultar bloque "incluye N
 * ventas del kanban") pero no decide la fuente del número.
 */

export interface KanbanSaleRow {
  id: string;
  lead_id: string;
  /**
   * Atribución de launch de la venta (Fase 8). Antes se derivaba de
   * `lead.launch_id`; ahora vive en la sale para soportar multi-venta con
   * distintos launches por lead.
   */
  launch_id: string | null;
  total_amount: number;
}

export interface KanbanPaymentRow {
  sale_id: string;
  amount: number;
}

export interface KanbanLeadStatusRow {
  id: string;
  status: string;
  launch_id: string | null;
}

export interface KanbanSalesAggregate {
  /** True si hay al menos 1 sale cuyo lead está en `cerrado` y en el launch. */
  hasData: boolean;
  /** Σ sale.total_amount (pactado). */
  pledgedRevenue: number;
  /** Σ payments.amount de las sales contadas (cobrado real). */
  collectedRevenue: number;
  /** Cantidad de ventas cerradas en el launch. */
  salesCount: number;
  /** Cantidad de payments individuales registrados sobre esas ventas. */
  paymentsCount: number;
}

export const EMPTY_KANBAN_SALES_AGGREGATE: KanbanSalesAggregate = {
  hasData: false,
  pledgedRevenue: 0,
  collectedRevenue: 0,
  salesCount: 0,
  paymentsCount: 0,
};

/**
 * Agrega ventas y cobros del kanban para un launch. La función filtra por:
 *   - `sale.launch_id === launchId` — Fase 8, atribución propia de la venta.
 *   - `lead.status === 'cerrado'` — la venta cuenta si el LEAD está cerrado
 *     (política que el KPI de revenue viene aplicando desde Fase 4b).
 *
 * `leads` se pasa como array (no map) para simetría con los otros aggregates
 * y para que el caller no tenga que pre-indexar. Adentro armamos el index
 * `lead_id → {status}` una sola vez.
 */
export function aggregateKanbanSales(
  sales: ReadonlyArray<KanbanSaleRow>,
  payments: ReadonlyArray<KanbanPaymentRow>,
  leads: ReadonlyArray<KanbanLeadStatusRow>,
  launchId: string,
): KanbanSalesAggregate {
  if (sales.length === 0) return EMPTY_KANBAN_SALES_AGGREGATE;

  const leadById = new Map<string, KanbanLeadStatusRow>();
  for (const l of leads) leadById.set(l.id, l);

  const countedSaleIds = new Set<string>();
  let pledgedRevenue = 0;
  let salesCount = 0;

  for (const s of sales) {
    if (s.launch_id !== launchId) continue;
    const lead = leadById.get(s.lead_id);
    if (!lead) continue;
    if (lead.status !== "cerrado") continue;

    countedSaleIds.add(s.id);
    salesCount++;
    const v = typeof s.total_amount === "number"
      ? s.total_amount
      : parseFloat(s.total_amount as unknown as string);
    if (Number.isFinite(v)) pledgedRevenue += v;
  }

  let collectedRevenue = 0;
  let paymentsCount = 0;
  for (const p of payments) {
    if (!countedSaleIds.has(p.sale_id)) continue;
    paymentsCount++;
    const v = typeof p.amount === "number"
      ? p.amount
      : parseFloat(p.amount as unknown as string);
    if (Number.isFinite(v)) collectedRevenue += v;
  }

  return {
    hasData: salesCount > 0,
    pledgedRevenue,
    collectedRevenue,
    salesCount,
    paymentsCount,
  };
}
