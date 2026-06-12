import "server-only";

import type { LeadStatus } from "@/lib/leads/types";

/**
 * Reglas de transición cuando un evento de GHL matchea (o no) con un lead.
 * Función pura: recibe el lead actual + el contexto del evento y devuelve qué
 * acción ejecutar. El orchestrator hace el INSERT/UPDATE.
 *
 * Modelo Fase 3b (decisiones del usuario):
 *
 *   Appointment (calendar event de GHL):
 *     - lead existente no terminal → status='agendado', pinned.
 *     - lead terminal (cerrado/perdido) → noop.
 *     - sin match → create source='ghl', status='agendado', pinned.
 *
 *   WhatsApp con 1 mensaje INBOUND:
 *     - sin lead → create source='whatsapp', status='frio', pinned.
 *     - lead existente con status menor (frio) → queda frio.
 *     - lead existente con status mayor → no toca (tibio sigue tibio, etc).
 *
 *   WhatsApp con 2+ mensajes INBOUND:
 *     - sin lead → create source='whatsapp', status='tibio', pinned.
 *     - lead existente no terminal con status menor → sube a tibio + pinned.
 *     - lead existente terminal → noop.
 *
 *   Contact con tag 'cliente':
 *     - sin lead → create source='ghl', status='cerrado', pinned.
 *     - lead existente no terminal → status='cerrado', pinned.
 *     - lead existente terminal → noop (ya estaba en estado final).
 *
 *   Contact sin tag 'cliente' (formulario sin actividad):
 *     - sin lead → create source='ghl', status='frio', pinned=FALSE
 *       (a la tabla, no al kanban — el brief diferencia esto explícitamente).
 *     - lead existente → noop (ya está en el sistema; el sync de WhatsApp/
 *       appointments se va a encargar de moverlo si corresponde).
 *
 * Idempotencia: si el `external_id` del evento ya está vinculado a un lead
 * con el mismo `source`, el orchestrator detecta el conflict del unique
 * parcial y NO crea duplicado.
 */

const TERMINAL_STATUSES: ReadonlySet<LeadStatus> = new Set<LeadStatus>([
  "cerrado",
  "perdido",
]);

/**
 * Orden de "calor" del status. Usamos esto para no degradar un lead: si ya
 * está en tibio y entra un evento de un solo mensaje, no lo bajamos a frio.
 */
const STATUS_ORDER: Record<LeadStatus, number> = {
  frio: 0,
  tibio: 1,
  agendado: 2,
  cerrado: 3,
  perdido: 3,
};

export type EventKind = "appointment" | "whatsapp" | "contact";

export interface ExistingLeadView {
  id: string;
  status: LeadStatus;
  pinned_to_kanban: boolean;
}

export type MatchAction =
  | {
      kind: "create";
      payload: {
        name: string;
        phone_normalized: string | null;
        contact: string | null;
        email: string | null;
        source: "ghl" | "whatsapp";
        status: LeadStatus;
        pinned_to_kanban: boolean;
        external_id: string;
        notes: string | null;
      };
    }
  | {
      kind: "update";
      leadId: string;
      patch: {
        status?: LeadStatus;
        pinned_to_kanban?: boolean;
        external_id?: string;
      };
    }
  | { kind: "noop"; reason: string };

export interface ResolveArgs {
  eventKind: EventKind;
  existing: ExistingLeadView | null;
  externalId: string;
  contactName: string;
  phoneNormalized: string | null;
  rawPhone: string | null;
  email?: string | null;
  /** Solo para eventKind='whatsapp'. Si null, fallback a tratar como frío. */
  inboundMessageCount?: number | null;
  /** Solo para eventKind='contact'. Indica si el contact tiene tag 'cliente'. */
  hasClientTag?: boolean;
}

export function resolveMatchAction(args: ResolveArgs): MatchAction {
  switch (args.eventKind) {
    case "appointment":
      return resolveAppointment(args);
    case "whatsapp":
      return resolveWhatsApp(args);
    case "contact":
      return resolveContact(args);
  }
}

// ─── appointment ────────────────────────────────────────────────────────────

function resolveAppointment(args: ResolveArgs): MatchAction {
  const { existing, externalId } = args;
  if (existing) {
    if (TERMINAL_STATUSES.has(existing.status)) {
      return { kind: "noop", reason: "lead_terminal" };
    }
    return {
      kind: "update",
      leadId: existing.id,
      patch: {
        status: "agendado",
        pinned_to_kanban: true,
        external_id: externalId,
      },
    };
  }
  return createPayload(args, "ghl", "agendado", true);
}

// ─── whatsapp ───────────────────────────────────────────────────────────────

function resolveWhatsApp(args: ResolveArgs): MatchAction {
  const { existing, externalId, inboundMessageCount } = args;
  // Frío si 0-1 mensajes del lead, tibio si 2+.
  const count = inboundMessageCount ?? 0;
  const targetStatus: LeadStatus = count >= 2 ? "tibio" : "frio";

  if (existing) {
    if (TERMINAL_STATUSES.has(existing.status)) {
      return { kind: "noop", reason: "lead_terminal" };
    }
    // No degradamos: si ya está más caliente, no lo bajamos.
    const currentRank = STATUS_ORDER[existing.status];
    const targetRank = STATUS_ORDER[targetStatus];
    if (targetRank > currentRank) {
      return {
        kind: "update",
        leadId: existing.id,
        patch: {
          status: targetStatus,
          pinned_to_kanban: true,
          external_id: externalId,
        },
      };
    }
    // Mismo o menor calor → solo refrescar external_id y asegurar pinned.
    return {
      kind: "update",
      leadId: existing.id,
      patch: { pinned_to_kanban: true, external_id: externalId },
    };
  }
  return createPayload(args, "whatsapp", targetStatus, true);
}

// ─── contact (formulario / CRM general) ─────────────────────────────────────

function resolveContact(args: ResolveArgs): MatchAction {
  const { existing, externalId, hasClientTag } = args;

  if (hasClientTag) {
    // Tag "cliente" → cerrado.
    if (existing) {
      if (TERMINAL_STATUSES.has(existing.status)) {
        // Ya está en cerrado o perdido — no tocamos.
        return { kind: "noop", reason: "lead_terminal" };
      }
      return {
        kind: "update",
        leadId: existing.id,
        patch: {
          status: "cerrado",
          pinned_to_kanban: true,
          external_id: externalId,
        },
      };
    }
    return createPayload(args, "ghl", "cerrado", true);
  }

  // Sin tag cliente:
  if (existing) {
    // El lead ya existe en el sistema. El sync de WhatsApp/appointments es
    // quien se encarga de moverlo si hay actividad. Acá no tocamos nada.
    return { kind: "noop", reason: "contact_already_synced" };
  }
  // Lead nuevo del CRM / formulario sin actividad → frío, tabla (no pinned).
  return createPayload(args, "ghl", "frio", false);
}

// ─── helper de create ──────────────────────────────────────────────────────

function createPayload(
  args: ResolveArgs,
  source: "ghl" | "whatsapp",
  status: LeadStatus,
  pinned: boolean,
): MatchAction {
  return {
    kind: "create",
    payload: {
      name: args.contactName,
      phone_normalized: args.phoneNormalized,
      contact: args.phoneNormalized ? null : args.rawPhone,
      email: args.email ?? null,
      source,
      status,
      pinned_to_kanban: pinned,
      external_id: args.externalId,
      notes: null,
    },
  };
}
