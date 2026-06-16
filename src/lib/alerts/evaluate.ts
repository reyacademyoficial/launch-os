import "server-only";

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
 *   - **cpl**: CPL ACUMULADO desde date_start hasta el día más reciente
 *     con datos = sum(spend) / sum(leads). Más estable que CPL diario:
 *     un día con pocos leads no dispara falsos positivos. Si no hay leads
 *     todavía, CPL no se calcula y no dispara.
 *
 *   - **inversion**: spend SOLO del día más reciente con datos. El uso
 *     intencionado es "alertame si gastaste más que X un día puntual".
 *     Suma los 3 providers (meta+google+tiktok) del día.
 *
 *   - **sin_leads**: cuenta de días consecutivos sin leads (cualquier
 *     canal: ads + manual). El "umbral" es la cantidad de días. Si nunca
 *     hubo leads, cuenta desde date_start. Si no arrancó todavía (today
 *     < date_start), no dispara. operator se ignora — siempre evalúa
 *     `días_sin_leads >= threshold`.
 *
 * Idempotencia: cada cruce produce 1 notificación por (launch, rule, día
 * UTC). Si el evaluator corre 10 veces el mismo día y la condición sigue
 * cruzada, la dedup_key absorbe las 9 repetidas.
 *
 * Errores: si falla la query o el insert, swallow. La alerta es nice-to-
 * have; un evaluator roto NO debe romper el sync o el daily.
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

    const launchRes = await loose(service)
      .from("launches")
      .select("project_id, date_start, date_end")
      .eq("id", launchId)
      .maybeSingle();
    const launch = launchRes.data as
      | { project_id: string; date_start: string | null; date_end: string | null }
      | null;
    if (!launch) return;

    const rulesRes = await loose(service)
      .from("alert_rules")
      .select("id, launch_id, metric, operator, threshold")
      .eq("launch_id", launchId)
      .eq("active", true);
    const rules = (rulesRes.data ?? []) as Array<
      Pick<AlertRuleRow, "id" | "metric" | "operator" | "threshold">
    >;
    if (rules.length === 0) return;

    const snapshot = await collectSnapshot(service, launchId, launch.date_start);

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
        p_body: `Valor actual: ${value}.`,
        p_target_role: "team",
        p_target_user_id: null,
        p_launch_id: launchId,
        p_dedup_key: `alert:${launchId}:${rule.id}:${today}`,
        p_metadata: {
          rule_id: rule.id,
          metric: rule.metric,
          operator: rule.operator,
          threshold: rule.threshold,
        },
      });
    }
  } catch {
    // Swallow — la evaluación de alertas es nice-to-have.
  }
}

// ─── snapshot del estado actual del launch ─────────────────────────────────

interface AlertSnapshot {
  cumulativeSpend: number;
  cumulativeLeadsAds: number;
  /** Spend del día más reciente con datos de ads (suma 3 providers). */
  lastDaySpend: number;
  /** Días consecutivos sin leads (ads ∪ manual) hasta hoy. */
  daysSinceLastLead: number | null;
}

const EMPTY_SNAPSHOT: AlertSnapshot = {
  cumulativeSpend: 0,
  cumulativeLeadsAds: 0,
  lastDaySpend: 0,
  daysSinceLastLead: null,
};

async function collectSnapshot(
  service: ServiceClient,
  launchId: string,
  dateStart: string | null,
): Promise<AlertSnapshot> {
  // Ads diarios sincronizados
  const adsRes = await loose(service)
    .from("launch_daily_ads")
    .select("date, spend, leads")
    .eq("launch_id", launchId)
    .order("date", { ascending: true });
  const ads = (adsRes.data ?? []) as Array<{
    date: string;
    spend: number;
    leads: number;
  }>;

  // Leads diarios manuales (cualquier canal)
  const manualRes = await loose(service)
    .from("launch_daily")
    .select("date, meta_ads, google_ads, tiktok_ads, organico, whatsapp, referidos, otro")
    .eq("launch_id", launchId)
    .order("date", { ascending: true });
  const manual = (manualRes.data ?? []) as Array<{
    date: string;
    meta_ads: number;
    google_ads: number;
    tiktok_ads: number;
    organico: number;
    whatsapp: number;
    referidos: number;
    otro: number;
  }>;

  const snap: AlertSnapshot = { ...EMPTY_SNAPSHOT };

  // CPL acumulado: suma spend / suma leads de ads.
  let totalSpend = 0;
  let totalLeadsAds = 0;
  for (const r of ads) {
    totalSpend += Number(r.spend) || 0;
    totalLeadsAds += Number(r.leads) || 0;
  }
  snap.cumulativeSpend = totalSpend;
  snap.cumulativeLeadsAds = totalLeadsAds;

  // Spend del día más reciente — suma de los 3 providers ese día (si el
  // sync persistió 3 filas, una por provider, para la misma fecha).
  if (ads.length > 0) {
    const lastDate = ads[ads.length - 1]!.date;
    snap.lastDaySpend = ads
      .filter((r) => r.date === lastDate)
      .reduce((acc, r) => acc + (Number(r.spend) || 0), 0);
  }

  // Días sin leads: comparar el "último día con leads" (ads o manual) contra
  // hoy. Si no hubo leads nunca, contamos desde date_start.
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

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  // Si el launch no arrancó, no aplica.
  if (dateStart && todayStr < dateStart) {
    snap.daysSinceLastLead = null;
  } else if (datesWithLeads.size === 0) {
    // Nunca hubo leads — contamos desde date_start (o desde hoy si no hay).
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
      if (snap.cumulativeLeadsAds <= 0) return false;
      const cpl = snap.cumulativeSpend / snap.cumulativeLeadsAds;
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
      if (snap.cumulativeLeadsAds <= 0) return "—";
      const cpl = snap.cumulativeSpend / snap.cumulativeLeadsAds;
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
