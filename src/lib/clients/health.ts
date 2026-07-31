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
 * REVISAR CON NEGOCIO: hoy no calculamos un "health_score compuesto" en TS.
 * `project_health.health_score` viene de afuera (operador o job futuro).
 * Este módulo solo expone los INGREDIENTES; la fórmula compuesta (ponderar
 * NPS + días sin contacto + tickets urgentes) se decide en negocio y se
 * agrega acá cuando esté acordada.
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
