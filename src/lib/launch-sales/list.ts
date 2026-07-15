import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { InstallmentRow, PaymentRow, SaleRow } from "@/lib/commissions/types";
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
  installments: InstallmentRow[];
  leads: Pick<
    LeadRow,
    "id" | "status" | "launch_id" | "name" | "team_member_id"
  >[];
}

export async function listLaunchSalesData(
  projectId: string,
  launchId: string,
): Promise<LaunchSalesData> {
  const supabase = await createClient();

  // Fase 8: filtramos por `sale.launch_id` (atribución propia de la
  // venta), no por `lead.launch_id`. Si un lead se recicla a otro launch,
  // la venta original queda anclada a su launch original.
  const salesRes = await supabase
    .from("sales")
    .select("*")
    .eq("project_id", projectId)
    .eq("launch_id", launchId)
    .order("closed_at", { ascending: false });

  const sales = (salesRes.data ?? []) as unknown as SaleRow[];

  if (sales.length === 0) {
    return { sales: [], payments: [], installments: [], leads: [] };
  }

  // Traemos los leads de las sales que ya seleccionamos — no filtramos por
  // `lead.launch_id` porque después de Fase 8 un lead puede haberse movido
  // a otro launch pero su venta vieja sigue anclada acá. Y traemos
  // payments + installments en paralelo (Fase 11).
  const leadIds = Array.from(new Set(sales.map((s) => s.lead_id)));
  const saleIds = sales.map((s) => s.id);

  const [leadsRes, paymentsRes, installmentsRes] = await Promise.all([
    supabase
      .from("leads")
      .select("id, status, launch_id, name, team_member_id")
      .in("id", leadIds),
    supabase
      .from("payments")
      .select("*")
      .in("sale_id", saleIds)
      .order("paid_at", { ascending: true }),
    supabase
      .from("installments")
      .select("*")
      .in("sale_id", saleIds)
      .order("sale_id", { ascending: true })
      .order("number", { ascending: true }),
  ]);

  const leads = (leadsRes.data ?? []) as Array<
    Pick<LeadRow, "id" | "status" | "launch_id" | "name" | "team_member_id">
  >;
  const payments = (paymentsRes.data ?? []) as unknown as PaymentRow[];
  const installments = (installmentsRes.data ?? []) as unknown as InstallmentRow[];
  return { sales, payments, installments, leads };
}

/**
 * Versión project-wide de `listLaunchSalesData` — trae TODAS las sales del
 * proyecto (sin filtro por launch) con sus payments, installments y leads
 * asociados. Sirve para la página `/proyectos/[id]/ventas` que lista ventas
 * a lo largo de todos los lanzamientos.
 *
 * No filtramos por lead.status='cerrado' acá: el caller (Ventas project-wide)
 * quiere ver TODAS las ventas registradas, incluso si el lead se movió a otra
 * columna después. La página de Cobros por launch sí filtra a cerrado para
 * cuadrar con el KPI de kanban.
 */
export async function listProjectSalesData(
  projectId: string,
): Promise<LaunchSalesData> {
  const supabase = await createClient();

  const salesRes = await supabase
    .from("sales")
    .select("*")
    .eq("project_id", projectId)
    .order("closed_at", { ascending: false });
  const sales = (salesRes.data ?? []) as unknown as SaleRow[];

  if (sales.length === 0) {
    return { sales: [], payments: [], installments: [], leads: [] };
  }

  const leadIds = Array.from(new Set(sales.map((s) => s.lead_id)));
  const saleIds = sales.map((s) => s.id);

  const [leadsRes, paymentsRes, installmentsRes] = await Promise.all([
    supabase
      .from("leads")
      .select("id, status, launch_id, name, team_member_id")
      .in("id", leadIds),
    supabase
      .from("payments")
      .select("*")
      .in("sale_id", saleIds)
      .order("paid_at", { ascending: true }),
    supabase
      .from("installments")
      .select("*")
      .in("sale_id", saleIds)
      .order("sale_id", { ascending: true })
      .order("number", { ascending: true }),
  ]);

  const leads = (leadsRes.data ?? []) as Array<
    Pick<LeadRow, "id" | "status" | "launch_id" | "name" | "team_member_id">
  >;
  const payments = (paymentsRes.data ?? []) as unknown as PaymentRow[];
  const installments = (installmentsRes.data ?? []) as unknown as InstallmentRow[];
  return { sales, payments, installments, leads };
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

  // Fase 8: incluir `launch_id` en el select. Sin él, el filtro del
  // aggregate por `s.launch_id === launchId` falla (undefined ≠ X) y
  // descarta todas las sales.
  const salesRes = await supabase
    .from("sales")
    .select("id, lead_id, launch_id, total_amount")
    .eq("project_id", projectId);
  const sales = (salesRes.data ?? []) as Array<KanbanSaleRow>;

  const out = new Map<string, KanbanSalesAggregate>();
  if (sales.length === 0) return out;

  // Bug 2026-07-14: antes traíamos TODOS los leads del proyecto y Supabase
  // paginea a 1000 por default. Proyectos con >1000 leads perdían los que
  // caían en filas 1001+, y sus ventas se descartaban silenciosamente en el
  // aggregate (leadById.get devolvía undefined). Ahora traemos solo los
  // leads referenciados por sales — con 58 sales son max 58 leads, siempre
  // adentro del limit por defecto.
  const leadIds = Array.from(new Set(sales.map((s) => s.lead_id)));
  const saleIds = sales.map((s) => s.id);

  const [leadsRes, paymentsRes] = await Promise.all([
    supabase
      .from("leads")
      .select("id, status, launch_id")
      .in("id", leadIds),
    supabase.from("payments").select("sale_id, amount").in("sale_id", saleIds),
  ]);
  const leads = (leadsRes.data ?? []) as Array<KanbanLeadStatusRow>;
  const payments = (paymentsRes.data ?? []) as Array<KanbanPaymentRow>;

  // Universo de launches a agregar: `sales.launch_id` (Fase 8, atribución
  // propia). No sumamos launches derivados de leads porque:
  //   - Un launch sin ventas devolvería revenue=0 igual que si no lo
  //     agregáramos — el caller ya tiene la lista de launches y renderiza
  //     el card con EMPTY si no está en el map.
  //   - Traer leads sin sales sería paginación pesada de vuelta.
  const launchIds = new Set<string>();
  for (const s of sales) {
    if (s.launch_id) launchIds.add(s.launch_id);
  }

  for (const launchId of launchIds) {
    out.set(launchId, aggregateKanbanSales(sales, payments, leads, launchId));
  }

  return out;
}

/** Reexport para conveniencia del caller. */
export { EMPTY_KANBAN_SALES_AGGREGATE };
export type { KanbanSalesAggregate };
