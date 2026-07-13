import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { PaymentRow, SaleRow } from "@/lib/commissions/types";

/**
 * Devuelve las ventas del proyecto atribuidas al launch indicado, con sus
 * payments asociados. Pensado para el reporte de comisiones cerradas por
 * launch.
 *
 * Fase 8: la atribución de launch vive en `sales.launch_id`, no en
 * `leads.launch_id`. Un lead reciclado a otro launch no arrastra sus ventas
 * viejas — quedan ancladas al launch original.
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

  const salesRes = await supabase
    .from("sales")
    .select("*")
    .eq("project_id", projectId)
    .eq("launch_id", launchId)
    .order("closed_at", { ascending: false });

  const sales = (salesRes.data ?? []) as unknown as SaleRow[];

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
