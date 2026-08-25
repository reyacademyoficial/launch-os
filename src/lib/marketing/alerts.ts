/**
 * Alertas de cobertura de contenido.
 *
 * Convierte el output de `computeDaysOfCoverage` en una lista tipada
 * `{contentOwnerId, platform, daysRemaining, severity}` para poder
 * pintar dots semánticos (rojo/ámbar) en Dashboard y Stock.
 *
 * Severity:
 *   - 'critical' → días de cobertura < umbral crítico (default 3)
 *   - 'warning'  → días de cobertura < umbral warning (default 7)
 *   - 'ok'       → resto
 *
 * Puro, sin efectos.
 */

import type { MarketingPlatform } from "./types";

export interface CoverageInput {
  readonly contentOwnerId: string;
  readonly platform: MarketingPlatform;
  readonly daysOfCoverage: number;
  readonly stockCount: number;
  readonly dailyRate: number;
}

export type AlertSeverity = "critical" | "warning" | "ok";

export interface CoverageAlert {
  readonly contentOwnerId: string;
  readonly platform: MarketingPlatform;
  readonly daysRemaining: number;
  readonly stockCount: number;
  readonly dailyRate: number;
  readonly severity: AlertSeverity;
}

export interface AlertThresholds {
  readonly criticalUnderDays: number;
  readonly warningUnderDays: number;
}

export const DEFAULT_ALERT_THRESHOLDS: AlertThresholds = {
  criticalUnderDays: 3,
  warningUnderDays: 7,
};

export function severityFor(
  daysOfCoverage: number,
  thresholds: AlertThresholds = DEFAULT_ALERT_THRESHOLDS,
): AlertSeverity {
  if (daysOfCoverage < thresholds.criticalUnderDays) return "critical";
  if (daysOfCoverage < thresholds.warningUnderDays) return "warning";
  return "ok";
}

export function computeCoverageAlerts(
  coverage: readonly CoverageInput[],
  thresholds: AlertThresholds = DEFAULT_ALERT_THRESHOLDS,
): CoverageAlert[] {
  const alerts: CoverageAlert[] = [];
  for (const c of coverage) {
    alerts.push({
      contentOwnerId: c.contentOwnerId,
      platform: c.platform,
      daysRemaining: c.daysOfCoverage,
      stockCount: c.stockCount,
      dailyRate: c.dailyRate,
      severity: severityFor(c.daysOfCoverage, thresholds),
    });
  }
  // Ordenar por severidad (críticas primero) y dentro por días asc.
  const rank: Record<AlertSeverity, number> = { critical: 0, warning: 1, ok: 2 };
  alerts.sort((a, b) => {
    const dr = rank[a.severity] - rank[b.severity];
    if (dr !== 0) return dr;
    return a.daysRemaining - b.daysRemaining;
  });
  return alerts;
}

/**
 * Solo las alertas que necesitan atención (severity !== 'ok'). Útil para
 * el panel del dashboard.
 */
export function actionableAlerts(alerts: readonly CoverageAlert[]): CoverageAlert[] {
  return alerts.filter((a) => a.severity !== "ok");
}

/**
 * Tono semántico para pintar el StateDot. Regla del proyecto: color solo
 * en el dot, nunca en el número.
 */
export function toneForSeverity(severity: AlertSeverity): string {
  if (severity === "critical") return "var(--kg-negative-500)";
  if (severity === "warning") return "var(--kg-warning-500)";
  return "var(--kg-positive-500)";
}
