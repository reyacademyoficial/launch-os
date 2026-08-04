/**
 * Selectores de SALUD del cliente (Bloque 3 · Kingrow).
 *
 * Funciones puras — sin acceso a DB. Reciben rows ya leídas por el caller y
 * devuelven número/desglose. Mismo estilo que `finance/kpis.ts`.
 *
 * ALCANCE
 *
 * "Cliente" = `project` (empresa gestionada). Este módulo NO toca los leads
 * del launch (que viven en `leads`) — son otro plano de existencia. Acá
 * medimos la RELACIÓN comercial Kingrow↔empresa.
 *
 * FÓRMULAS DOCUMENTADAS
 *
 * NPS de una serie de respuestas (0..10):
 *   promoter  = score ∈ [9, 10]
 *   passive   = score ∈ [7, 8]
 *   detractor = score ∈ [0, 6]
 *   NPS%      = (%promoters − %detractors) × 100   → rango [-100, +100]
 *
 * daysSinceLastContact:
 *   ceil((now − last_contact_at) / 86_400_000)     → null si nunca contactó
 *
 * openTickets: count(status ∈ {abierto, en_progreso, esperando_cliente})
 * urgentOpenTickets: subset con priority='urgente'
 *
 * HEALTH SCORE COMPUESTO (v1, adoptado 2026-08):
 *
 * Ingredientes (0..100 cada uno):
 *   npsComponent      = último NPS reciente × 10        (null si sin NPS en 90d)
 *   contactComponent  = 100 - días_sin_contacto × 100/90 clampeado a [0,100]
 *                                                        (null si sin fecha)
 *   ticketsComponent  = 100 - urgentes_abiertos × 25    (siempre presente,
 *                                                        0 urgentes → 100)
 *
 * Pesos (redistribución cuando falta un ingrediente):
 *   los 3            → NPS 40%, contact 30%, tickets 30%
 *   sin NPS          → contact 50%, tickets 50%
 *   sin contact      → NPS 60%, tickets 40%
 *   sin ambos        → tickets 100%
 *
 * Score final es entero 0..100. El caller decide qué hacer cuando `isLimited`
 * es true (típicamente mostrar badge "Datos limitados" en la UI).
 *
 * Esta fórmula NO reemplaza el override manual en `project_health.health_score`.
 * El caller aplica la política: si el override es no-null, gana; si es null,
 * usa el resultado de `computeHealthScore`.
 */

import type {
  NpsBucket,
  NpsResponseRow,
  ProjectHealthRow,
  TicketRow,
} from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// NPS
// ═══════════════════════════════════════════════════════════════════════════

export function classifyNps(score: number): NpsBucket {
  if (score >= 9) return "promoter";
  if (score >= 7) return "passive";
  return "detractor";
}

export interface NpsBreakdown {
  totalResponses: number;
  promoters: number;
  passives: number;
  detractors: number;
  /** Rango [-100, +100]. `null` si no hay respuestas (evita 0 confuso). */
  npsScore: number | null;
  /** Promedio simple de scores. `null` si no hay respuestas. */
  averageScore: number | null;
}

export function computeNps(responses: NpsResponseRow[]): NpsBreakdown {
  const totalResponses = responses.length;
  if (totalResponses === 0) {
    return {
      totalResponses: 0,
      promoters: 0,
      passives: 0,
      detractors: 0,
      npsScore: null,
      averageScore: null,
    };
  }

  let promoters = 0;
  let passives = 0;
  let detractors = 0;
  let sum = 0;
  for (const r of responses) {
    sum += r.score;
    const bucket = classifyNps(r.score);
    if (bucket === "promoter") promoters++;
    else if (bucket === "passive") passives++;
    else detractors++;
  }

  const npsScore =
    ((promoters - detractors) / totalResponses) * 100;

  return {
    totalResponses,
    promoters,
    passives,
    detractors,
    npsScore,
    averageScore: sum / totalResponses,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Actividad de contacto
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Días transcurridos desde el último touchpoint. `null` si nunca hubo
 * contacto registrado. El caller pasa `now` para que la función sea pura
 * (default = Date.now() para uso rápido en UI).
 */
export function daysSinceLastContact(
  health: Pick<ProjectHealthRow, "last_contact_at">,
  now: Date = new Date(),
): number | null {
  if (!health.last_contact_at) return null;
  const then = new Date(health.last_contact_at).getTime();
  const diffMs = now.getTime() - then;
  if (diffMs < 0) return 0; // fecha futura → tratamos como "hoy"
  return Math.ceil(diffMs / 86_400_000);
}

// ═══════════════════════════════════════════════════════════════════════════
// Tickets abiertos
// ═══════════════════════════════════════════════════════════════════════════

const OPEN_STATUSES = new Set<TicketRow["status"]>([
  "abierto",
  "en_progreso",
  "esperando_cliente",
]);

export interface TicketLoad {
  openTickets: number;
  urgentOpenTickets: number;
}

export function computeTicketLoad(tickets: TicketRow[]): TicketLoad {
  let openTickets = 0;
  let urgentOpenTickets = 0;
  for (const t of tickets) {
    if (!OPEN_STATUSES.has(t.status)) continue;
    openTickets++;
    if (t.priority === "urgente") urgentOpenTickets++;
  }
  return { openTickets, urgentOpenTickets };
}

// ═══════════════════════════════════════════════════════════════════════════
// Health score compuesto
// ═══════════════════════════════════════════════════════════════════════════

/** Ventana de "NPS reciente" para el ingrediente. */
export const NPS_RECENT_WINDOW_DAYS = 90;

/** Días a partir de los cuales el contact_component es 0. */
export const CONTACT_SCORE_CAP_DAYS = 90;

/** Cuánto resta cada ticket urgente abierto al score de tickets. */
export const TICKETS_SCORE_STEP = 25;

export interface HealthScoreInputs {
  /** NPS responses del cliente — la función filtra por ventana. */
  readonly nps: readonly NpsResponseRow[];
  /** Último contacto registrado. `null` si nunca hubo. */
  readonly lastContactAt: string | null;
  /** Tickets del cliente — la función filtra abiertos + urgentes. */
  readonly tickets: readonly TicketRow[];
  /** Inyectable para tests deterministas. */
  readonly now?: Date;
}

export interface HealthScoreWeights {
  readonly nps: number;
  readonly contact: number;
  readonly tickets: number;
}

export interface HealthScoreBreakdown {
  /** 0..100 o null si no hay NPS reciente. */
  readonly npsComponent: number | null;
  /** 0..100 o null si no hay fecha de último contacto. */
  readonly contactComponent: number | null;
  /** 0..100. Siempre presente — 0 urgentes abiertos = 100. */
  readonly ticketsComponent: number;
  /** Pesos aplicados a esta computación (redistribuidos si faltan ingredientes). */
  readonly weights: HealthScoreWeights;
  /** Score final 0..100, entero. */
  readonly score: number;
  /** `true` si algún ingrediente faltó y se redistribuyeron los pesos. */
  readonly isLimited: boolean;
}

function computeNpsComponent(
  nps: readonly NpsResponseRow[],
  now: Date,
): number | null {
  const cutoffMs = now.getTime() - NPS_RECENT_WINDOW_DAYS * 86_400_000;
  let latest: NpsResponseRow | null = null;
  let latestMs = -Infinity;
  for (const r of nps) {
    const ts = new Date(r.responded_at).getTime();
    if (!Number.isFinite(ts)) continue;
    if (ts < cutoffMs) continue;
    if (ts > latestMs) {
      latest = r;
      latestMs = ts;
    }
  }
  if (latest == null) return null;
  return latest.score * 10;
}

function computeContactComponent(
  lastContactAt: string | null,
  now: Date,
): number | null {
  const days = daysSinceLastContact({ last_contact_at: lastContactAt }, now);
  if (days == null) return null;
  const raw = 100 - (days * 100) / CONTACT_SCORE_CAP_DAYS;
  return Math.max(0, Math.min(100, raw));
}

function computeTicketsComponent(tickets: readonly TicketRow[]): number {
  const load = computeTicketLoad(tickets as TicketRow[]);
  const raw = 100 - load.urgentOpenTickets * TICKETS_SCORE_STEP;
  return Math.max(0, Math.min(100, raw));
}

function resolveWeights(
  hasNps: boolean,
  hasContact: boolean,
): HealthScoreWeights {
  if (hasNps && hasContact) return { nps: 0.4, contact: 0.3, tickets: 0.3 };
  if (!hasNps && hasContact) return { nps: 0, contact: 0.5, tickets: 0.5 };
  if (hasNps && !hasContact) return { nps: 0.6, contact: 0, tickets: 0.4 };
  return { nps: 0, contact: 0, tickets: 1 };
}

/**
 * Calcula el health score compuesto de un cliente. Función pura — sin DB,
 * sin fetch. Recibe rows ya cargadas por el caller.
 */
export function computeHealthScore(
  inputs: HealthScoreInputs,
): HealthScoreBreakdown {
  const now = inputs.now ?? new Date();
  const npsComponent = computeNpsComponent(inputs.nps, now);
  const contactComponent = computeContactComponent(inputs.lastContactAt, now);
  const ticketsComponent = computeTicketsComponent(inputs.tickets);

  const weights = resolveWeights(npsComponent != null, contactComponent != null);
  const weightedSum =
    (npsComponent ?? 0) * weights.nps +
    (contactComponent ?? 0) * weights.contact +
    ticketsComponent * weights.tickets;

  const score = Math.round(Math.max(0, Math.min(100, weightedSum)));
  const isLimited = npsComponent == null || contactComponent == null;

  return {
    npsComponent,
    contactComponent,
    ticketsComponent,
    weights,
    score,
    isLimited,
  };
}
