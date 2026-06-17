import "server-only";

import type { DailyAggregate } from "@/lib/launch-daily/aggregate";
import { safeDiv, safePercent } from "@/lib/kpis";
import { createClient } from "@/lib/supabase/server";

/**
 * Datos del tab "Canales / origen" — dos dimensiones distintas:
 *
 *  1. Canales pagos (Meta / Google / TikTok): leads + spend del daily
 *     aggregate. CPL = spend / leads. Sin ventas/conversion (el modelo no
 *     atribuye sale → canal pago).
 *
 *  2. Source del lead (manual / import / meta / ghl / whatsapp / otro) +
 *     dimensión sintética "reciclados" (recycled_from_launch_id NOT NULL).
 *     Para cada source: count(leads), ventas atribuibles (sales.lead_id),
 *     revenue, conversion. "reciclados" cuenta DOBLE (también en su source
 *     original) — decisión del usuario para medir efectividad del reciclado
 *     sin perderlo en el bucket original.
 *
 * Scope:
 *   - Canales pagos: suma sobre los `aggregateMergedDaily` de los launches
 *     filtrados. Si no hay launches en scope, devuelve totales en 0.
 *   - Source: leads `WHERE launch_id IN (...)`. Si no hay filtro, todos
 *     los leads del proyecto.
 */

export interface PaidChannelRow {
  channel: "Meta" | "Google" | "TikTok";
  leads: number;
  spend: number;
  cpl: number;
}

export interface LeadSourceRow {
  /** "manual" | "import" | … | "reciclados". El último es sintético. */
  source: string;
  leads: number;
  sales: number;
  revenue: number;
  /** % = sales / leads. 0 si leads = 0. */
  conversion: number;
}

export interface ChannelsData {
  paid: PaidChannelRow[];
  bySource: LeadSourceRow[];
}

export async function getChannelsData(args: {
  projectId: string;
  launchIds: ReadonlyArray<string> | null;
  adsByLaunch: ReadonlyMap<string, DailyAggregate>;
}): Promise<ChannelsData> {
  // 1) Sumar los aggregates por canal pago — pasamos sobre los launches en
  //    scope. Si `launchIds` es null usamos TODOS los launches del map.
  const paidLaunches = args.launchIds
    ? Array.from(args.launchIds)
    : Array.from(args.adsByLaunch.keys());

  let metaLeads = 0,
    metaSpend = 0,
    googleLeads = 0,
    googleSpend = 0,
    tiktokLeads = 0,
    tiktokSpend = 0;

  for (const launchId of paidLaunches) {
    const agg = args.adsByLaunch.get(launchId);
    if (!agg) continue;
    metaLeads += agg.metaLeads;
    metaSpend += agg.metaSpend;
    googleLeads += agg.googleLeads;
    googleSpend += agg.googleSpend;
    tiktokLeads += agg.tiktokLeads;
    tiktokSpend += agg.tiktokSpend;
  }

  const paid: PaidChannelRow[] = [
    {
      channel: "Meta",
      leads: metaLeads,
      spend: metaSpend,
      cpl: safeDiv(metaSpend, metaLeads),
    },
    {
      channel: "Google",
      leads: googleLeads,
      spend: googleSpend,
      cpl: safeDiv(googleSpend, googleLeads),
    },
    {
      channel: "TikTok",
      leads: tiktokLeads,
      spend: tiktokSpend,
      cpl: safeDiv(tiktokSpend, tiktokLeads),
    },
  ];

  // 2) Por source del lead — query leads del scope con join a sales para
  //    ventas/revenue. Postgrest acepta el join via `sales(total_amount)`
  //    sin filtro (deja null para los leads sin sale).
  const bySource = await querySourceBreakdown(args);

  return { paid, bySource };
}

type Sb = Awaited<ReturnType<typeof createClient>>;

interface LeadRowMinimal {
  source: string;
  recycled_from_launch_id: string | null;
  sales: { total_amount: number | string | null } | null;
}

const KNOWN_SOURCES = [
  "manual",
  "import",
  "meta",
  "ghl",
  "whatsapp",
  "otro",
] as const;

async function querySourceBreakdown(args: {
  projectId: string;
  launchIds: ReadonlyArray<string> | null;
}): Promise<LeadSourceRow[]> {
  const supabase: Sb = await createClient();

  let q = supabase
    .from("leads")
    .select("source, recycled_from_launch_id, sales(total_amount)")
    .eq("project_id", args.projectId);

  if (args.launchIds && args.launchIds.length > 0) {
    q = q.in("launch_id", args.launchIds as string[]);
  }

  // PostgREST por default trae max 1000 filas. Para volumen alto del scope
  // usamos `range(0, ...)` con cap defensivo. A 50k leads la respuesta
  // pesa ~5MB y tarda 1-2s — aceptable para una vista de análisis.
  const { data, error } = await q.range(0, 49_999);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as LeadRowMinimal[];

  // Bucket por source + bucket adicional "reciclados".
  const buckets = new Map<string, { leads: number; sales: number; revenue: number }>();
  for (const src of KNOWN_SOURCES) {
    buckets.set(src, { leads: 0, sales: 0, revenue: 0 });
  }
  buckets.set("reciclados", { leads: 0, sales: 0, revenue: 0 });

  for (const r of rows) {
    const source = (KNOWN_SOURCES as ReadonlyArray<string>).includes(r.source)
      ? r.source
      : "otro";
    const sale = r.sales;
    const saleAmount = sale ? toNumber(sale.total_amount) : 0;
    const hasSale = sale != null;

    const orig = buckets.get(source)!;
    orig.leads += 1;
    if (hasSale) {
      orig.sales += 1;
      orig.revenue += saleAmount;
    }

    if (r.recycled_from_launch_id) {
      const rec = buckets.get("reciclados")!;
      rec.leads += 1;
      if (hasSale) {
        rec.sales += 1;
        rec.revenue += saleAmount;
      }
    }
  }

  return Array.from(buckets.entries()).map(([source, v]) => ({
    source,
    leads: v.leads,
    sales: v.sales,
    revenue: v.revenue,
    conversion: safePercent(v.sales, v.leads),
  }));
}

function toNumber(v: number | string | null | undefined): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}
