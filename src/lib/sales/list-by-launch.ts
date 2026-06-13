import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { PaymentRow, SaleRow } from "@/lib/commissions/types";

/**
 * Devuelve las ventas del proyecto cuyo **lead** pertenece al launch indicado,
 * con sus payments asociados. Pensado para el reporte de comisiones cerradas
 * por launch.
 *
 * Por qué pasa por leads: el modelo (0014) no ata sales directo a launches —
 * sales tiene `lead_id`, y leads tiene `launch_id` opcional. Filtrar por launch
 * implica resolver "ventas cuyo lead está asignado a este launch".
 *
 * Estrategia de 2 queries (en paralelo) en vez de un join cruzado:
 *   1. `sales!inner(lead → leads!inner)` filtrando por launch_id en el inner join.
 *   2. `payments` por `in("sale_id", saleIds)`.
 *
 * RLS sigue activa — un launchId de otro proyecto devuelve [] sin error.
 */

export interface SaleWithPayments {
  sale: SaleRow;
  payments: PaymentRow[];
}

export async function listSalesByLaunch(
  projectId: string,
  launchId: string,
): Promise<SaleWithPayments[]> {
  const supabase = await createClient();

  // 1) Ventas del proyecto cuyo lead.launch_id matchea. `leads!inner` fuerza
  //    el join y el filtro `leads.launch_id` aplica al JOIN, no a sales.
  const salesRes = await supabase
    .from("sales")
    .select("*, leads!inner(launch_id)")
    .eq("project_id", projectId)
    .eq("leads.launch_id", launchId)
    .order("closed_at", { ascending: false });

  // Drop la columna anidada `leads` después del filtro (no la necesitamos
  // arriba — sólo sirvió para el join). El cast asume el shape de sales puro.
  const sales = ((salesRes.data ?? []) as Array<SaleRow & { leads: unknown }>).map(
    (r) => {
      const { leads: _drop, ...sale } = r;
      void _drop;
      return sale as SaleRow;
    },
  );

  if (sales.length === 0) return [];

  // 2) Payments en lote por todos los sale_id que sacamos.
  const saleIds = sales.map((s) => s.id);
  const paymentsRes = await supabase
    .from("payments")
    .select("*")
    .in("sale_id", saleIds)
    .order("paid_at", { ascending: true });

  const payments = (paymentsRes.data ?? []) as unknown as PaymentRow[];
  const paymentsBySale = new Map<string, PaymentRow[]>();
  for (const p of payments) {
    const list = paymentsBySale.get(p.sale_id);
    if (list) list.push(p);
    else paymentsBySale.set(p.sale_id, [p]);
  }

  return sales.map((sale) => ({
    sale,
    payments: paymentsBySale.get(sale.id) ?? [],
  }));
}
