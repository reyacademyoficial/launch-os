import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { PaymentRow, SaleRow } from "@/lib/commissions/types";

export async function getSaleByLeadId(leadId: string): Promise<SaleRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sales")
    .select("*")
    .eq("lead_id", leadId)
    .maybeSingle();
  return (data as SaleRow | null) ?? null;
}

export async function getSale(saleId: string): Promise<SaleRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sales")
    .select("*")
    .eq("id", saleId)
    .maybeSingle();
  return (data as SaleRow | null) ?? null;
}

export async function listPaymentsForSale(saleId: string): Promise<PaymentRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("payments")
    .select("*")
    .eq("sale_id", saleId)
    .order("paid_at", { ascending: false })
    .order("created_at", { ascending: false });

  return (data ?? []) as unknown as PaymentRow[];
}

/**
 * Tamaño de chunk para paginar. Supabase aplica cap server-side de 1000 rows
 * que `.range()` con valores más grandes NO supera — hay que iterar.
 */
const ROWS_PAGE_SIZE = 1000;
const SALES_LIST_HARD_CAP = 50_000;
const PAYMENTS_LIST_HARD_CAP = 100_000;
const PAYMENTS_SALE_ID_CHUNK = 500;

export async function listSalesForProject(projectId: string): Promise<SaleRow[]> {
  const supabase = await createClient();
  const out: SaleRow[] = [];
  let from = 0;
  while (from < SALES_LIST_HARD_CAP) {
    const to = from + ROWS_PAGE_SIZE - 1;
    const { data } = await supabase
      .from("sales")
      .select("*")
      .eq("project_id", projectId)
      .order("closed_at", { ascending: false })
      .range(from, to);
    const rows = (data ?? []) as unknown as SaleRow[];
    if (rows.length === 0) break;
    out.push(...rows);
    if (rows.length < ROWS_PAGE_SIZE) break;
    from += ROWS_PAGE_SIZE;
  }
  return out;
}

/**
 * Todos los payments del proyecto vía join implícito por sale_id. RLS filtra
 * por has_project_access(project_of_sale(...)) — un sale de otro proyecto
 * devuelve 0 payments. Para 4b alcanza con este pull; si crece, switcheamos a
 * un query agregado en la DB.
 *
 * Doble paginación: chunkea sale_ids a 500 por `.in()` (URL length) Y dentro
 * de cada chunk pagina la respuesta de a 1000 (cap server-side de Supabase).
 */
export async function listPaymentsForProject(
  projectId: string,
): Promise<PaymentRow[]> {
  const supabase = await createClient();
  const sales = await listSalesForProject(projectId);
  if (sales.length === 0) return [];
  const saleIds = sales.map((s) => s.id);
  const all: PaymentRow[] = [];
  for (let i = 0; i < saleIds.length; i += PAYMENTS_SALE_ID_CHUNK) {
    const slice = saleIds.slice(i, i + PAYMENTS_SALE_ID_CHUNK);
    let from = 0;
    while (from < PAYMENTS_LIST_HARD_CAP) {
      const to = from + ROWS_PAGE_SIZE - 1;
      const { data } = await supabase
        .from("payments")
        .select("*")
        .in("sale_id", slice)
        .order("paid_at", { ascending: false })
        .range(from, to);
      const rows = (data ?? []) as unknown as PaymentRow[];
      if (rows.length === 0) break;
      all.push(...rows);
      if (rows.length < ROWS_PAGE_SIZE) break;
      from += ROWS_PAGE_SIZE;
    }
  }
  return all;
}
