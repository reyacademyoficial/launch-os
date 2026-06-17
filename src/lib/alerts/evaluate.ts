import "server-only";

import { calculateLaunchKPIs } from "@/lib/kpis";
import { aggregateMergedDaily } from "@/lib/launch-daily/aggregate";
import { mergeDailyData, type AdsDailyRow } from "@/lib/launch-daily/merge";
import type { LaunchDailyRow } from "@/lib/launch-daily/types";
import type { LaunchRow } from "@/lib/launches/types";
import { createServiceClient } from "@/lib/supabase/service";

import type { AlertMetric, AlertOperator, AlertRuleRow } from "./types";
import { ALERT_METRIC_LABELS } from "./types";

/**
 * Evaluator de alertas para un launch.
 *
 * Se invoca después de cada cambio de datos:
 *   - sync OK (post-finalizeRun success): el spend / leads del día más
 *     reciente pudieron mover los umbrales.
 *   - daily manual cargado (post-createDailyEntry / updateDailyEntry):
 *     mismo razonamiento.
 *
 * Decisiones de cálculo (estables, documentadas):
 *
 *   - **cpl**: CPL ACUMULADO = totalInvestment / totalLeads, usando la
 *     MISMA lógica que `calculateLaunchKPIs` (lib/kpis.ts). Eso significa
 *     que respeta el fallback documentado del KPI grid: si hay sync
 *     (`adsAggregate.daysCovered > 0`) usa los datos sincronizados; si no,
 *     fallback a las columnas manuales del launch (`meta_investment`,
 *     `meta_leads`, idem google y tiktok). El usuario
 *     ve un solo número de CPL en pantalla — la alerta usa ese mismo.
 *
 *     Walk-back 2026-06-16: antes el evaluator leía SOLO `launch_daily_ads`.
 *     Eso ignoraba los campos manuales del form, lo que volvía la alerta
 *     CPL inútil para launches sin sync (CPL=0/0 siempre).
 *
 *   - **inversion**: spend del día más reciente con datos sincronizados.
 *     Mantiene su semántica original ("alertame si un día puntual gastaste
 *     más que X"), pero ahora si NO hay sync, fallback al total manual del
 *     form. Eso pierde la noción "del día" en el caso manual — documentado
 *     en la UI con el hint "Spend del día más reciente con datos de ads
 *     cargados". Si nunca cargaste ads, el threshold se compara contra el
 *     total manual.
 *
 *   - **sin_leads**: días consecutivos sin leads (ads ∪ manual). Si nunca
 *     hubo leads, cuenta desde date_start. Si no arrancó todavía, no
 *     dispara. operator se ignora — siempre evalúa `días >= threshold`.
 *
 * Idempotencia: 1 notif por (launch, rule, día UTC). Dedup_key absorbe.
 *
 * Errores: try/catch global. Un evaluator roto no rompe sync ni daily.
 */

type ServiceClient = ReturnType<typeof createServiceClient>;
/* eslint-disable @typescript-eslint/no-explicit-any */
type LooseClient = {
  from: (n: string) => any;
  rpc: (n: string, args?: Record<string, unknown>) => any;
};
/* eslint-enable @typescript-eslint/no-explicit-any */
function loose(svc: unknown): LooseClient {
  return svc as LooseClient;
}

export async function evaluateAlertsForLaunch(launchId: string): Promise<void> {
  try {
    const service = createServiceClient();

    // Traemos el launch ENTERO — los campos manuales (meta_investment, etc.)
    // los usa `calculateLaunchKPIs` como fallback cuando no hay sync.
    const launchRes = await loose(service)
      .from("launches")
      .select("*, projects!inner(name)")
      .eq("id", launchId)
      .maybeSingle();
    const launch = launchRes.data as
      | (LaunchRow & { projects: { name: string } | null })
      | null;
    if (!launch) return;
    const projectName = launch.projects?.name ?? "Proyecto";
    const launchName = launch.name ?? "Lanzamiento";

    const rulesRes = await loose(service)
      .from("alert_rules")
      .select("id, launch_id, metric, operator, threshold")
      .eq("launch_id", launchId)
      .eq("active", true);
    const rules = (rulesRes.data ?? []) as Array<
      Pick<AlertRuleRow, "id" | "metric" | "operator" | "threshold">
    >;
    if (rules.length === 0) return;

    const snapshot = await collectSnapshot(service, launch);

    const today = new Date().toISOString().slice(0, 10);

    for (const rule of rules) {
      const crossed = evaluateRule(rule.metric, rule.operator, rule.threshold, snapshot);
      if (!crossed) continue;

      const value = formatValue(rule.metric, snapshot);
      await loose(service).rpc("create_notification", {
        p_project_id: launch.project_id,
        p_type: "alert_crossed",
        p_title: `Alerta: ${ALERT_METRIC_LABELS[rule.metric]} ${rule.operator} ${rule.threshold}`,
        p_severity: "warning",
        p_body: `${projectName} · ${launchName}\nValor actual: ${value}.`,
        p_target_role: "team",
        p_target_user_id: null,
        p_launch_id: launchId,
        p_dedup_key: `alert:${launchId}:${rule.id}:${today}`,
        p_metadata: {
          rule_id: rule.id,
          metric: rule.metric,
          operator: rule.operator,
          threshold: rule.threshold,
          project_name: projectName,
          launch_name: launchName,
        },
      });
    }
  } catch {
    // Swallow — la evaluación de alertas es nice-to-have.
  }
}

// ─── snapshot del estado actual del launch ─────────────────────────────────

interface AlertSnapshot {
  /** Inversión total (acumulada) — usa el mismo fallback que el KPI grid. */
  totalInvestment: number;
  /** Leads totales de ads (acumulados) — mismo fallback. */
  totalLeadsAds: number;
  /**
   * Spend del día más reciente con datos sincronizados, si hay. Si no, cae
   * a `totalInvestment` (sin noción "del día").
   */
  lastDaySpend: number;
  /** True si `lastDaySpend` se calculó sobre un día real del sync. */
  hasSyncDay: boolean;
  /** Días consecutivos sin leads (ads ∪ manual) hasta hoy. */
  daysSinceLastLead: number | null;
}

const EMPTY_SNAPSHOT: AlertSnapshot = {
  totalInvestment: 0,
  totalLeadsAds: 0,
  lastDaySpend: 0,
  hasSyncDay: false,
  daysSinceLastLead: null,
};

async function collectSnapshot(
  service: ServiceClient,
  launch: LaunchRow,
): Promise<AlertSnapshot> {
  // Daily manual (launch_daily) — para mergeDailyData + sin_leads.
  const manualRes = await loose(service)
    .from("launch_daily")
    .select("*")
    .eq("launch_id", launch.id)
    .order("date", { ascending: true });
  const manual = (manualRes.data ?? []) as LaunchDailyRow[];

  // Ads sincronizados (launch_daily_ads) — para mergeDailyData + lastDay.
  const adsRes = await loose(service)
    .from("launch_daily_ads")
    .select("date, provider, spend, impressions, clicks, leads")
    .eq("launch_id", launch.id)
    .order("date", { ascending: true });
  const ads = (adsRes.data ?? []) as AdsDailyRow[];

  // Misma cadena que el KPI grid:
  //   merge(manual, ads) → aggregateMergedDaily → calculateLaunchKPIs.
  // El KPI ya respeta el fallback "si daysCovered > 0 usa agregado, sino
  // usa los campos manuales del form del launch".
  const merged = mergeDailyData(manual, ads);
  const adsAggregate = aggregateMergedDaily(merged);
  const kpi = calculateLaunchKPIs(launch, { adsAggregate });

  const snap: AlertSnapshot = { ...EMPTY_SNAPSHOT };
  snap.totalInvestment = kpi.totalInvestment;
  snap.totalLeadsAds = kpi.totalLeads;

  // lastDaySpend: si hay días sincronizados, suma el spend del día más
  // reciente (puede haber N filas para esa fecha — 1 por provider). Si no,
  // fallback al total manual (semántica del threshold cambia en este caso,
  // ver doc del modulo).
  if (ads.length > 0) {
    const lastDate = ads[ads.length - 1]!.date;
    snap.lastDaySpend = ads
      .filter((r) => r.date === lastDate)
      .reduce((acc, r) => acc + (Number(r.spend) || 0), 0);
    snap.hasSyncDay = true;
  } else {
    snap.lastDaySpend = kpi.totalInvestment;
    snap.hasSyncDay = false;
  }

  // sin_leads: días consecutivos sin leads contando ads ∪ manual.
  const datesWithLeads = new Set<string>();
  for (const r of ads) {
    if ((Number(r.leads) || 0) > 0) datesWithLeads.add(r.date);
  }
  for (const r of manual) {
    const total =
      (r.meta_ads ?? 0) +
      (r.google_ads ?? 0) +
      (r.tiktok_ads ?? 0) +
      (r.organico ?? 0) +
      (r.whatsapp ?? 0) +
      (r.referidos ?? 0) +
      (r.otro ?? 0);
    if (total > 0) datesWithLeads.add(r.date);
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const dateStart = launch.date_start;

  if (dateStart && todayStr < dateStart) {
    snap.daysSinceLastLead = null;
  } else if (datesWithLeads.size === 0) {
    if (dateStart) {
      snap.daysSinceLastLead = diffDays(dateStart, todayStr);
    }
  } else {
    const sorted = Array.from(datesWithLeads).sort();
    const last = sorted[sorted.length - 1]!;
    snap.daysSinceLastLead = diffDays(last, todayStr);
  }

  return snap;
}

function diffDays(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, Math.round((to - from) / 86400000));
}

// ─── evaluación por métrica ────────────────────────────────────────────────

function evaluateRule(
  metric: AlertMetric,
  operator: AlertOperator,
  threshold: number,
  snap: AlertSnapshot,
): boolean {
  switch (metric) {
    case "cpl": {
      if (snap.totalLeadsAds <= 0) return false;
      const cpl = snap.totalInvestment / snap.totalLeadsAds;
      return compare(cpl, operator, threshold);
    }
    case "inversion": {
      return compare(snap.lastDaySpend, operator, threshold);
    }
    case "sin_leads": {
      // sin_leads ignora operator — la semántica es "días consecutivos
      // sin leads excedió N". Si threshold=0 evita disparar todo el
      // tiempo: requerimos > 0 para tener significado.
      if (threshold <= 0) return false;
      if (snap.daysSinceLastLead === null) return false;
      return snap.daysSinceLastLead >= threshold;
    }
  }
}

function compare(value: number, operator: AlertOperator, threshold: number): boolean {
  switch (operator) {
    case ">":
      return value > threshold;
    case ">=":
      return value >= threshold;
    case "<":
      return value < threshold;
    case "<=":
      return value <= threshold;
  }
}

function formatValue(metric: AlertMetric, snap: AlertSnapshot): string {
  switch (metric) {
    case "cpl": {
      if (snap.totalLeadsAds <= 0) return "—";
      const cpl = snap.totalInvestment / snap.totalLeadsAds;
      return `$${cpl.toFixed(2)}`;
    }
    case "inversion":
      return `$${snap.lastDaySpend.toFixed(2)}`;
    case "sin_leads":
      return snap.daysSinceLastLead === null
        ? "—"
        : `${snap.daysSinceLastLead} día${snap.daysSinceLastLead === 1 ? "" : "s"}`;
  }
}
