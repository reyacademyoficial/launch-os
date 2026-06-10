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

export async function listSalesForProject(projectId: string): Promise<SaleRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sales")
    .select("*")
    .eq("project_id", projectId)
    .order("closed_at", { ascending: false });
  return (data ?? []) as unknown as SaleRow[];
}

/**
 * Todos los payments del proyecto vía join implícito por sale_id. RLS filtra
 * por has_project_access(project_of_sale(...)) — un sale de otro proyecto
 * devuelve 0 payments. Para 4b alcanza con este pull; si crece, switcheamos a
 * un query agregado en la DB.
 */
export async function listPaymentsForProject(
  projectId: string,
): Promise<PaymentRow[]> {
  const supabase = await createClient();
  const sales = await listSalesForProject(projectId);
  if (sales.length === 0) return [];
  const saleIds = sales.map((s) => s.id);
  const { data } = await supabase
    .from("payments")
    .select("*")
    .in("sale_id", saleIds)
    .order("paid_at", { ascending: false });
  return (data ?? []) as unknown as PaymentRow[];
}
