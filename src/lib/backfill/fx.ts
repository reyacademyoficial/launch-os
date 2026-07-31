import "server-only";

import { buildFxRateMap, resolveMonthlyRateFromMap } from "@/lib/money";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Backfill one-shot: convierte a USD los payments históricos que se
 * cargaron en pesos contra bancos USD (por costumbre, cuando la operación
 * era "todo en pesos"). Análogo para sales.total_amount.
 *
 * TASA usada por cada payment:
 *   1. Si el sale del payment tiene un launch con `ars_per_usd` seteado →
 *      usa esa tasa. Es la tasa "comercial" del launch, la más precisa.
 *   2. Fallback a `project_fx_rates` del mes de `paid_at` del payment.
 *   3. Si ni una ni otra existen → skip y log en el reporte. El operador
 *      va a tener que cargar la tasa del mes y re-correr.
 *
 * IDEMPOTENTE: skipeamos filas con `original_currency IS NOT NULL` (ya
 * migradas). Corrida N veces = mismo estado.
 *
 * SALES: para `sales.total_amount` usamos la tasa del launch del sale (sin
 * fallback mensual — el sale sí tiene relación directa con el launch, y si
 * el launch no está marcado como ARS-operado, no es candidato). Los sales
 * sin launch se saltan.
 *
 * Este módulo usa el service client (bypassa RLS) porque el backfill se
 * dispara desde `/financiero/tasas` y necesita alcanzar payments/sales de
 * TODOS los proyectos, incluidos los que el superadmin puede no tener
 * membership explícita.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type LooseClient = {
  from: (name: string) => any;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

interface RawPaymentJoin {
  id: string;
  amount: number;
  paid_at: string;
  original_currency: string | null;
  payment_method_id: string | null;
  sale_id: string;
  payment_methods: {
    bank_id: string | null;
    banks: { currency: "ARS" | "USD" } | null;
  } | null;
  sales: {
    id: string;
    project_id: string;
    leads: { launch_id: string | null } | null;
  } | null;
}

interface RawSaleJoin {
  id: string;
  total_amount: number;
  original_currency: string | null;
  project_id: string;
  lead_id: string;
  leads: {
    launch_id: string | null;
    launches: { ars_per_usd: number | null } | null;
  } | null;
}

interface RawFxRateRow {
  project_id: string;
  month: string;
  ars_per_usd: number;
}

interface RawLaunchRow {
  id: string;
  ars_per_usd: number | null;
}

export interface FxBackfillReport {
  /** Payments candidatos (bank USD + original_currency null). */
  paymentsScanned: number;
  paymentsConverted: number;
  /** Payments sin tasa (ni launch ni mensual) — se saltearon. */
  paymentsSkippedNoRate: number;
  /** Payments cuyo método no tenía banco — se saltearon defensivamente. */
  paymentsSkippedNoBank: number;
  salesScanned: number;
  salesConverted: number;
  salesSkippedNoRate: number;
  /** Ids problemáticos para que el operador pueda auditar. Capado a 20. */
  problemPaymentIds: string[];
  problemSaleIds: string[];
}

/**
 * Dry-run: cuenta candidatos y detecta faltantes SIN escribir nada. Usado
 * para el preview de la UI antes de que el operador confirme la corrida.
 */
export async function previewFxBackfill(): Promise<FxBackfillReport> {
  return await runFxBackfillImpl({ apply: false });
}

/**
 * Corrida real: aplica los UPDATE en payments y sales. Después de esto los
 * saldos de bancos USD que estaban distorsionados por cobros en pesos
 * quedan correctos.
 */
export async function runFxBackfill(): Promise<FxBackfillReport> {
  return await runFxBackfillImpl({ apply: true });
}

async function runFxBackfillImpl(opts: {
  apply: boolean;
}): Promise<FxBackfillReport> {
  const svc = createServiceClient() as unknown as LooseClient;

  // ─── 1) Payments candidatos ─────────────────────────────────────────
  //
  // Query con dos joins para traer todo lo necesario en una vuelta:
  //   - payment_methods → banks: para saber la moneda del banco.
  //   - sales → leads: para llegar al launch_id (nullable).
  //
  // Filtramos `original_currency IS NULL` para idempotencia y
  // `banks.currency = USD` porque los payments contra banco ARS ya están
  // en la moneda correcta (no hay que tocarlos).
  const paymentsRes = await svc
    .from("payments")
    .select(
      "id, amount, paid_at, original_currency, payment_method_id, sale_id, " +
        "payment_methods(bank_id, banks(currency)), " +
        "sales(id, project_id, leads(launch_id))",
    )
    .is("original_currency", null);

  const rawPayments = (paymentsRes.data ?? []) as unknown as RawPaymentJoin[];
  // Filtro cliente-side por bank.currency='USD' porque PostgREST no permite
  // filtrar por columna de tabla joineada anidada 2 niveles.
  const candidates = rawPayments.filter(
    (p) => p.payment_methods?.banks?.currency === "USD",
  );

  // ─── 2) Cargar tasas — launches involucrados + fx_rates de sus proyectos
  const launchIds = new Set<string>();
  const projectIds = new Set<string>();
  for (const p of candidates) {
    const lid = p.sales?.leads?.launch_id ?? null;
    if (lid) launchIds.add(lid);
    if (p.sales?.project_id) projectIds.add(p.sales.project_id);
  }

  const [launchesRes, ratesRes] = await Promise.all([
    launchIds.size > 0
      ? svc
          .from("launches")
          .select("id, ars_per_usd")
          .in("id", Array.from(launchIds))
      : Promise.resolve({ data: [] }),
    projectIds.size > 0
      ? svc
          .from("project_fx_rates")
          .select("project_id, month, ars_per_usd")
          .in("project_id", Array.from(projectIds))
      : Promise.resolve({ data: [] }),
  ]);

  const launchRateById = new Map<string, number | null>();
  for (const l of (launchesRes.data ?? []) as RawLaunchRow[]) {
    launchRateById.set(l.id, l.ars_per_usd ?? null);
  }

  // fxByProject[projectId] = Map<"YYYY-MM", rate>
  const fxByProject = new Map<string, Map<string, number>>();
  const ratesByProjectRaw = new Map<string, RawFxRateRow[]>();
  for (const r of (ratesRes.data ?? []) as RawFxRateRow[]) {
    const list = ratesByProjectRaw.get(r.project_id) ?? [];
    list.push(r);
    ratesByProjectRaw.set(r.project_id, list);
  }
  for (const [pid, rows] of ratesByProjectRaw) {
    fxByProject.set(pid, buildFxRateMap(rows));
  }

  const report: FxBackfillReport = {
    paymentsScanned: candidates.length,
    paymentsConverted: 0,
    paymentsSkippedNoRate: 0,
    paymentsSkippedNoBank: 0,
    salesScanned: 0,
    salesConverted: 0,
    salesSkippedNoRate: 0,
    problemPaymentIds: [],
    problemSaleIds: [],
  };

  // ─── 3) Procesar payments ───────────────────────────────────────────
  for (const p of candidates) {
    // Redundante con el filtro de arriba, pero defensivo — si un día
    // agregamos payments sin método (imposible por FK, pero…).
    if (!p.payment_methods?.bank_id) {
      report.paymentsSkippedNoBank++;
      pushCapped(report.problemPaymentIds, p.id);
      continue;
    }

    const launchId = p.sales?.leads?.launch_id ?? null;
    const projectId = p.sales?.project_id ?? null;
    const launchRate = launchId
      ? launchRateById.get(launchId) ?? null
      : null;
    const monthlyRate = projectId
      ? resolveMonthlyRateFromMap(
          fxByProject.get(projectId) ?? new Map(),
          p.paid_at,
        )
      : null;

    const rate =
      launchRate && launchRate > 0
        ? launchRate
        : monthlyRate && monthlyRate > 0
          ? monthlyRate
          : null;

    if (!rate) {
      report.paymentsSkippedNoRate++;
      pushCapped(report.problemPaymentIds, p.id);
      continue;
    }

    if (opts.apply) {
      const newAmount = Number(p.amount) / rate;
      const upd = await svc
        .from("payments")
        .update({
          amount: newAmount,
          original_amount: p.amount,
          original_currency: "ARS",
        })
        .eq("id", p.id)
        .is("original_currency", null); // guard doble contra race con reruns
      if (upd.error) {
        // Si un UPDATE falla no abortamos toda la corrida — logueamos y
        // seguimos. El operador ve el count divergente en el report.
        report.paymentsSkippedNoRate++;
        pushCapped(report.problemPaymentIds, p.id);
        continue;
      }
    }
    report.paymentsConverted++;
  }

  // ─── 4) Procesar sales ──────────────────────────────────────────────
  //
  // Regla más simple que payments: usamos SOLO la tasa del launch del sale
  // (sin fallback mensual). Los sales sin launch o con launch sin tasa se
  // saltean — el operador puede cargar la tasa del launch y re-correr.
  const salesRes = await svc
    .from("sales")
    .select(
      "id, total_amount, original_currency, project_id, lead_id, " +
        "leads(launch_id, launches(ars_per_usd))",
    )
    .is("original_currency", null);
  const rawSales = (salesRes.data ?? []) as unknown as RawSaleJoin[];

  // Filtramos solo los sales cuyo launch tiene tasa cargada — el resto no
  // son candidatos (los USD-nativos no se tocan, y los sin tasa no se
  // pueden convertir).
  const saleCandidates = rawSales.filter(
    (s) => (s.leads?.launches?.ars_per_usd ?? 0) > 0,
  );
  report.salesScanned = saleCandidates.length;

  for (const s of saleCandidates) {
    const rate = s.leads?.launches?.ars_per_usd ?? null;
    if (!rate || rate <= 0) {
      report.salesSkippedNoRate++;
      pushCapped(report.problemSaleIds, s.id);
      continue;
    }

    if (opts.apply) {
      const newAmount = Number(s.total_amount) / rate;
      const upd = await svc
        .from("sales")
        .update({
          total_amount: newAmount,
          original_total_amount: s.total_amount,
          original_currency: "ARS",
        })
        .eq("id", s.id)
        .is("original_currency", null);
      if (upd.error) {
        report.salesSkippedNoRate++;
        pushCapped(report.problemSaleIds, s.id);
        continue;
      }
    }
    report.salesConverted++;
  }

  return report;
}

function pushCapped(arr: string[], id: string, cap = 20): void {
  if (arr.length < cap) arr.push(id);
}
