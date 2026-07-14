import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { InstallmentRow } from "@/lib/commissions/types";

/**
 * Trae las cuotas de un conjunto de ventas, ordenadas por (sale_id, number).
 * Los llamadores agrupan por sale_id en memoria. Usado por la tab de cobros
 * del launch para calcular monto vencido/próx vencimiento por venta.
 */
export async function listInstallmentsForSales(
  saleIds: ReadonlyArray<string>,
): Promise<InstallmentRow[]> {
  if (saleIds.length === 0) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("installments")
    .select("*")
    .in("sale_id", saleIds as string[])
    .order("sale_id", { ascending: true })
    .order("number", { ascending: true });

  return (data ?? []) as unknown as InstallmentRow[];
}
