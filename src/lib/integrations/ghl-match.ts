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
  /**
   * Campos opcionales agregados en el refactor bulk (Fase 3b post-mortem).
   * Permiten que el caller detecte updates no-op (cuando el patch dice "setear
   * external_id=X" y X ya es el valor actual) y los saltee. Si no se popula,
   * se asume que el patch debe aplicarse igual.
   */
  external_id?: string | null;
  source?: string | null;
  phone_normalized?: string | null;
  team_member_id?: string | null;
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
        team_member_id: string | null;
      };
    }
  | {
      kind: "update";
      leadId: string;
      patch: {
        status?: LeadStatus;
        pinned_to_kanban?: boolean;
        external_id?: string;
        team_member_id?: string | null;
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
  /**
   * Solo para eventKind='contact'. Hay conversación WhatsApp con actividad
   * inbound del lead dentro de la ventana compra+cierre del launch. Si true,
   * arranca como 'tibio' (en vez de 'frio') para el lead nuevo, y promueve
   * a tibio al existente que estaba frio.
   */
  hasRecentInboundActivity?: boolean;
  /**
   * Solo para eventKind='appointment'. Status del evento según GHL: cuando
   * es 'cancelled' o 'noshow' tratamos al appointment como noop — el lead
   * no pasa a 'agendado'.
   */
  appointmentStatus?: string | null;
  /**
   * Vendedor asignado en el sistema (resuelto del mapping GHL→team_member).
   * Si null o undefined no toca team_member_id del lead. Si tiene valor,
   * lo setea/actualiza.
   */
  teamMemberId?: string | null;
}

/** Status del appointment que NO deben crear/promover a 'agendado'. */
const APPOINTMENT_INACTIVE_STATUSES: ReadonlySet<string> = new Set([
  "cancelled",
  "canceled", // tolerancia a la variante US
  "noshow",
  "no_show",
  "invalid",
]);

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
  const { existing, externalId, appointmentStatus, teamMemberId } = args;

  // Appointments cancelados o noshow no agendan a nadie. Sin lead existente,
  // tampoco creamos uno solo por un appointment fallido.
  if (
    appointmentStatus &&
    APPOINTMENT_INACTIVE_STATUSES.has(appointmentStatus.toLowerCase())
  ) {
    return { kind: "noop", reason: `appointment_${appointmentStatus.toLowerCase()}` };
  }

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
        ...(teamMemberId !== undefined ? { team_member_id: teamMemberId } : {}),
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
  const { existing, externalId, hasClientTag, hasRecentInboundActivity, teamMemberId } = args;

  // Status objetivo según señales: cliente > actividad inbound reciente > default frio.
  // El orden importa: si tiene tag 'cliente', va a cerrado aunque también haya
  // respondido en WhatsApp.
  let targetStatus: LeadStatus;
  if (hasClientTag) targetStatus = "cerrado";
  else if (hasRecentInboundActivity) targetStatus = "tibio";
  else targetStatus = "frio";

  // Pinned al kanban si tiene actividad real (tibio/cerrado/agendado). Los
  // contacts frios sin actividad van a la tabla, no al kanban — mismo
  // criterio que tenía la versión anterior.
  const pinned = targetStatus !== "frio";

  if (existing) {
    if (TERMINAL_STATUSES.has(existing.status)) {
      // 'cerrado' o 'perdido' nunca se reabre desde el sync. Refrescamos
      // team_member_id si vino del mapping, nada más.
      if (teamMemberId !== undefined) {
        return {
          kind: "update",
          leadId: existing.id,
          patch: { team_member_id: teamMemberId },
        };
      }
      return { kind: "noop", reason: "lead_terminal" };
    }

    const currentRank = STATUS_ORDER[existing.status];
    const targetRank = STATUS_ORDER[targetStatus];

    // Subir solo si el target es más caliente. Mantener (mismo o menor)
    // no degrada — un lead 'agendado' no baja a 'tibio' ni a 'frio'.
    if (targetRank > currentRank) {
      return {
        kind: "update",
        leadId: existing.id,
        patch: {
          status: targetStatus,
          pinned_to_kanban: true,
          external_id: externalId,
          ...(teamMemberId !== undefined ? { team_member_id: teamMemberId } : {}),
        },
      };
    }

    // No degradar: refrescar external_id y vendedor si vino, sin tocar el status.
    return {
      kind: "update",
      leadId: existing.id,
      patch: {
        external_id: externalId,
        ...(teamMemberId !== undefined ? { team_member_id: teamMemberId } : {}),
      },
    };
  }

  // Lead nuevo — status según señales, pinned según calor.
  return createPayload(args, "ghl", targetStatus, pinned);
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
      team_member_id: args.teamMemberId ?? null,
    },
  };
}
