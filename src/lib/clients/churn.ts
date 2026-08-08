/**
 * CHURN de clientes gestionados — Bloque 3 · Kingrow.
 *
 * DEFINICIÓN ADOPTADA (churn confirmado):
 *   Un cliente cuenta como CHURNED si al menos una de las dos cosas:
 *     a) project_health.relationship_status = 'perdida'
 *     b) La renewal más reciente del cliente tiene status = 'perdida'
 *
 * Es un OR — la fuente de verdad más rica gana. Un operador puede marcar
 * un cliente como perdido antes de que expire su renewal (churn temprano),
 * o una renewal perdida puede detectar churn que el operador no marcó.
 *
 * "EN RIESGO" (churn probable, no confirmado):
 *     relationship_status = 'en_riesgo'
 *   El caller decide si sumar esta métrica al churn hard o mostrarla
 *   aparte como "leading indicator".
 *
 * FÓRMULAS
 *
 *   churnRate(cohort) = churned / total
 *   Solo cohorts >= 1 cliente para evitar división por cero (devolvemos
 *   null en ese caso — el consumer decide cómo renderizarlo).
 *
 * NO HAY ROLLING WINDOW: churnRate lifetime = churned al día de hoy sobre
 * total histórico del cohort que pasás. Si querés churn del último año,
 * filtrá el cohort antes (clients.created_at > cutoff).
 *
 * // REVISAR CON NEGOCIO: la definición de churn en SaaS suele ser
 * "cliente no renovó en ventana de X días desde vencimiento". Nuestra
 * def es más simple porque en Kingrow el operador toma la decisión y la
 * marca. Cuando se implemente cron de detección automática, se ajusta acá.
 */

import type { ProjectHealthRow, RenewalRow } from "./types";

export interface ChurnInput {
  /** project_health del cliente. Determina churn por relationship_status. */
  health: Pick<ProjectHealthRow, "client_id" | "relationship_status"> | null;
  /** Renewals del cliente. Solo la más reciente entra al chequeo. */
  renewals: RenewalRow[];
}

/**
 * Devuelve `true` si el cliente cuenta como churned confirmado.
 * Ver docstring del módulo para la definición completa.
 */
export function isChurned(input: ChurnInput): boolean {
  if (input.health?.relationship_status === "perdida") return true;
  const latest = latestRenewal(input.renewals);
  return latest?.status === "perdida";
}

/**
 * Devuelve `true` si el cliente está en riesgo (churn probable, no
 * confirmado). Excluyente con isChurned (perdida NO es en_riesgo).
 */
export function isAtRisk(
  health: Pick<ProjectHealthRow, "relationship_status"> | null,
): boolean {
  return health?.relationship_status === "en_riesgo";
}

function latestRenewal(renewals: RenewalRow[]): RenewalRow | null {
  if (renewals.length === 0) return null;
  let latest = renewals[0]!;
  for (let i = 1; i < renewals.length; i++) {
    const r = renewals[i]!;
    if (r.period_end > latest.period_end) latest = r;
  }
  return latest;
}

// ═══════════════════════════════════════════════════════════════════════════
// Agregación por cohort
// ═══════════════════════════════════════════════════════════════════════════

export interface ChurnCohortEntry {
  clientId: string;
  input: ChurnInput;
}

export interface ChurnRateBreakdown {
  totalClients: number;
  churnedClients: number;
  atRiskClients: number;
  /** [0..1]. `null` si totalClients=0 (evita división por cero). */
  churnRate: number | null;
  /** [0..1]. `null` si totalClients=0. */
  atRiskRate: number | null;
}

export function computeChurnRate(
  cohort: ChurnCohortEntry[],
): ChurnRateBreakdown {
  const totalClients = cohort.length;
  if (totalClients === 0) {
    return {
      totalClients: 0,
      churnedClients: 0,
      atRiskClients: 0,
      churnRate: null,
      atRiskRate: null,
    };
  }

  let churnedClients = 0;
  let atRiskClients = 0;
  for (const { input } of cohort) {
    if (isChurned(input)) churnedClients++;
    else if (isAtRisk(input.health)) atRiskClients++;
  }

  return {
    totalClients,
    churnedClients,
    atRiskClients,
    churnRate: churnedClients / totalClients,
    atRiskRate: atRiskClients / totalClients,
  };
}
