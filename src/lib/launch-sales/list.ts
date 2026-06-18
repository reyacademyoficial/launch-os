import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { PaymentRow, SaleRow } from "@/lib/commissions/types";
import type { LeadRow } from "@/lib/leads/types";

import {
  aggregateKanbanSales,
  EMPTY_KANBAN_SALES_AGGREGATE,
  type KanbanLeadStatusRow,
  type KanbanPaymentRow,
  type KanbanSaleRow,
  type KanbanSalesAggregate,
} from "./aggregate";

/**
 * Trae los datos crudos de kanban (sales + payments + leads relevantes) para
 * un launch. La función NO filtra por status='cerrado' acá — devuelve TODAS
 * las sales/leads del launch para que el caller pueda usar lo mismo para el
 * agregado KPI (que filtra adentro por cerrado) y para la tabla del tab de
 * cobros (que puede querer mostrar el detalle por status).
 *
 * Estrategia (mismo patrón que listSalesByLaunch):
 *   1) Leads del launch (id, status, launch_id).
 *   2) Sales del proyecto cuyo lead.launch_id matchea.
 *   3) Payments para los sale_id resultantes.
 * Las 3 queries van en paralelo donde posible.
 */
export interface LaunchSalesData {
  sales: SaleRow[];
  payments: PaymentRow[];
  leads: Pick<LeadRow, "id" | "status" | "launch_id" | "name">[];
}

export async function listLaunchSalesData(
  projectId: string,
  launchId: string,
): Promise<LaunchSalesData> {
  const supabase = await createClient();

  const [leadsRes, salesRes] = await Promise.all([
    supabase
      .from("leads")
      .select("id, status, launch_id, name")
      .eq("project_id", projectId)
      .eq("launch_id", launchId),
    supabase
      .from("sales")
      .select("*, leads!inner(launch_id)")
      .eq("project_id", projectId)
      .eq("leads.launch_id", launchId)
      .order("closed_at", { ascending: false }),
  ]);

  const leads = (leadsRes.data ?? []) as Array<
    Pick<LeadRow, "id" | "status" | "launch_id" | "name">
  >;
  const sales = ((salesRes.data ?? []) as Array<SaleRow & { leads: unknown }>).map(
    (r) => {
      const { leads: _drop, ...sale } = r;
      void _drop;
      return sale as SaleRow;
    },
  );

  if (sales.length === 0) return { sales: [], payments: [], leads };

  const saleIds = sales.map((s) => s.id);
  const paymentsRes = await supabase
    .from("payments")
    .select("*")
    .in("sale_id", saleIds)
    .order("paid_at", { ascending: true });

  const payments = (paymentsRes.data ?? []) as unknown as PaymentRow[];
  return { sales, payments, leads };
}

/**
 * Calcula el agregado de kanban (sales+payments en cerrado) para un launch.
 * Helper de conveniencia que combina `listLaunchSalesData` + agregado.
 */
export async function getKanbanSalesAggregateForLaunch(
  projectId: string,
  launchId: string,
): Promise<KanbanSalesAggregate> {
  const { sales, payments, leads } = await listLaunchSalesData(projectId, launchId);
  return aggregateKanbanSales(
    sales as unknown as KanbanSaleRow[],
    payments as unknown as KanbanPaymentRow[],
    leads as unknown as KanbanLeadStatusRow[],
    launchId,
  );
}

/**
 * Versión por proyecto en una sola pasada — evita N+1 cuando hay que armar
 * KPIs de muchos launches (dashboard, lista de launches, analítica).
 *
 * Estrategia: 3 queries en paralelo a nivel proyecto, después se agrupa en
 * memoria. RLS filtra por proyecto.
 */
export async function getKanbanSalesAggregatesForProject(
  projectId: string,
): Promise<Map<string, KanbanSalesAggregate>> {
  const supabase = await createClient();

  const [leadsRes, salesRes] = await Promise.all([
    supabase
      .from("leads")
      .select("id, status, launch_id")
      .eq("project_id", projectId),
    supabase
      .from("sales")
      .select("id, lead_id, total_amount")
      .eq("project_id", projectId),
  ]);

  const leads = (leadsRes.data ?? []) as Array<KanbanLeadStatusRow>;
  const sales = (salesRes.data ?? []) as Array<KanbanSaleRow>;

  const out = new Map<string, KanbanSalesAggregate>();

  if (sales.length === 0) return out;

  const saleIds = sales.map((s) => s.id);
  const paymentsRes = await supabase
    .from("payments")
    .select("sale_id, amount")
    .in("sale_id", saleIds);
  const payments = (paymentsRes.data ?? []) as Array<KanbanPaymentRow>;

  // Agrupar leads por launch_id para saber qué launches existen.
  const launchIds = new Set<string>();
  for (const l of leads) {
    if (l.launch_id) launchIds.add(l.launch_id);
  }

  for (const launchId of launchIds) {
    out.set(launchId, aggregateKanbanSales(sales, payments, leads, launchId));
  }

  return out;
}

/** Reexport para conveniencia del caller. */
export { EMPTY_KANBAN_SALES_AGGREGATE };
export type { KanbanSalesAggregate };
