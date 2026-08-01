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

/**
 * Computa revenue estimado y cobrado en USD para cada launch del proyecto
 * que tenga ars_per_usd configurado. Usa la misma lógica de detección de
 * moneda del banco/método que kpi/page.tsx: original_currency > banco del
 * método > moneda del método > ARS por defecto.
 *
 * Returns Map<launchId, { pledgedUsd, collectedUsd }>.
 * Solo incluye launches con tasa > 0 en ratePerLaunch.
 */
export async function getProjectRevenueUsdMap(
  projectId: string,
  ratePerLaunch: ReadonlyMap<string, number | null>,
  paymentMethods: ReadonlyArray<{
    id: string;
    bank_id: string | null;
    currency: "ARS" | "USD" | null;
  }>,
  banks: ReadonlyArray<{ id: string; currency: "ARS" | "USD" }>,
): Promise<Map<string, { pledgedUsd: number; collectedUsd: number }>> {
  const supabase = await createClient();

  const salesRes = await supabase
    .from("sales")
    .select("id, lead_id, launch_id, total_amount")
    .eq("project_id", projectId);
  const sales = (salesRes.data ?? []) as Array<{
    id: string;
    lead_id: string;
    launch_id: string | null;
    total_amount: number;
  }>;

  if (sales.length === 0) return new Map();

  const leadIds = Array.from(new Set(sales.map((s) => s.lead_id)));
  const saleIds = sales.map((s) => s.id);

  const [leadsRes, paymentsRes] = await Promise.all([
    supabase.from("leads").select("id, status").in("id", leadIds),
    supabase
      .from("payments")
      .select("sale_id, amount, original_currency, payment_method_id")
      .in("sale_id", saleIds),
  ]);

  const leadById = new Map(
    ((leadsRes.data ?? []) as Array<{ id: string; status: string }>).map(
      (l) => [l.id, l],
    ),
  );

  const paymentsBySale = new Map<
    string,
    Array<{
      amount: number;
      original_currency: string | null;
      payment_method_id: string | null;
    }>
  >();
  for (const p of (paymentsRes.data ?? []) as Array<{
    sale_id: string;
    amount: number;
    original_currency: string | null;
    payment_method_id: string | null;
  }>) {
    const arr = paymentsBySale.get(p.sale_id) ?? [];
    arr.push(p);
    paymentsBySale.set(p.sale_id, arr);
  }

  const banksById = new Map(banks.map((b) => [b.id, b]));
  const methodCurrency = new Map(
    paymentMethods.map((m) => {
      const bankCur = m.bank_id ? banksById.get(m.bank_id)?.currency : null;
      return [m.id, bankCur ?? m.currency ?? "ARS"] as const;
    }),
  );

  const result = new Map<string, { pledgedUsd: number; collectedUsd: number }>();

  for (const [launchId, rate] of ratePerLaunch) {
    if (!rate || rate <= 0) continue;

    const cerradoSales = sales.filter(
      (s) =>
        s.launch_id === launchId &&
        leadById.get(s.lead_id)?.status === "cerrado",
    );

    let pledgedUsd = 0;
    let collectedUsd = 0;

    for (const s of cerradoSales) {
      pledgedUsd += Number(s.total_amount) / rate;
      for (const p of paymentsBySale.get(s.id) ?? []) {
        const pCurrency: "ARS" | "USD" =
          p.original_currency === "USD"
            ? "USD"
            : p.original_currency === "ARS"
              ? "ARS"
              : p.payment_method_id
                ? (methodCurrency.get(p.payment_method_id) ?? "ARS")
                : "ARS";
        collectedUsd +=
          pCurrency === "USD"
            ? Number(p.amount)
            : Number(p.amount) / rate;
      }
    }

    result.set(launchId, { pledgedUsd, collectedUsd });
  }

  return result;
}

/** Reexport para conveniencia del caller. */
export { EMPTY_KANBAN_SALES_AGGREGATE };
export type { KanbanSalesAggregate };
