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

async function fetchPaginated<T>(
  hardCap: number,
  fetchPage: (from: number, to: number) => Promise<readonly T[]>,
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  while (from < hardCap) {
    const to = from + ROWS_PAGE_SIZE - 1;
    const rows = await fetchPage(from, to);
    if (rows.length === 0) break;
    out.push(...rows);
    if (rows.length < ROWS_PAGE_SIZE) break;
    from += ROWS_PAGE_SIZE;
  }
  return out;
}

export async function listSalesForProject(projectId: string): Promise<SaleRow[]> {
  const supabase = await createClient();
  return fetchPaginated<SaleRow>(SALES_LIST_HARD_CAP, async (from, to) => {
    const { data } = await supabase
      .from("sales")
      .select("*")
      .eq("project_id", projectId)
      .order("closed_at", { ascending: false })
      .range(from, to);
    return (data ?? []) as unknown as SaleRow[];
  });
}

/**
 * Todos los payments del proyecto. Migración 0045 denormalizó `project_id` en
 * `payments` con trigger + RLS reescrita, así que este pull es una sola
 * consulta paginada (~1 request por cada 1000 filas). Antes había que traer
 * TODAS las sales, chunkear los sale_ids a 500 y paginar cada chunk contra
 * `payments.in("sale_id", ...)` — ~25+ requests con RLS N×1 por fila
 * (subquery `project_of_sale` per row). Eso era el culpable de los 3 minutos
 * de carga del leaderboard.
 */
export async function listPaymentsForProject(
  projectId: string,
): Promise<PaymentRow[]> {
  const supabase = await createClient();
  return fetchPaginated<PaymentRow>(PAYMENTS_LIST_HARD_CAP, async (from, to) => {
    const { data } = await supabase
      .from("payments")
      .select("*")
      .eq("project_id", projectId)
      .order("paid_at", { ascending: false })
      .range(from, to);
    return (data ?? []) as unknown as PaymentRow[];
  });
}
