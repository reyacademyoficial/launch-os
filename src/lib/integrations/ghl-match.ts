import "server-only";

import type { LeadStatus } from "@/lib/leads/types";

/**
 * Reglas de transición cuando un evento de GHL matchea (o no) con un lead.
 * Función pura: recibe el lead actual + el contexto del evento y devuelve qué
 * acción ejecutar. El orchestrator hace el INSERT/UPDATE.
 *
 * Modelo Fase 3b (cierre):
 *
 *   Appointment (calendar event de GHL):
 *     - status cancelled/canceled/noshow/no_show/invalid → noop.
 *     - lead existente terminal (cerrado/perdido) → noop.
 *     - lead existente no terminal → status='agendado', pinned.
 *     - sin match → create source='ghl', status='agendado', pinned.
 *
 *   Contact con tag 'cliente':
 *     - sin lead → create source='ghl', status='cerrado', pinned.
 *     - lead existente no terminal → status='cerrado', pinned.
 *     - lead existente terminal → noop (refresca team_member si vino).
 *
 *   Contact con señal `hasRecentInboundActivity` (un mensaje WhatsApp
 *   inbound dentro de la ventana compra+cierre del launch):
 *     - sin lead → create source='ghl', status='tibio', pinned.
 *     - lead frio → sube a tibio + pinned.
 *     - lead más caliente (tibio/agendado/cerrado/perdido) → no degrada.
 *
 *   Contact default (sin tag cliente, sin actividad inbound):
 *     - sin lead → create source='ghl', status='frio', pinned=FALSE
 *       (a la tabla, no al kanban).
 *     - lead existente → update mínimo (refresca external_id + team_member_id),
 *       no toca status.
 *
 * Regla "no degradar": un status superior nunca baja por una señal inferior
 * (`STATUS_ORDER`).
 *
 * Idempotencia: si el `external_id` del evento ya está vinculado a un lead
 * con el mismo `source`, el orchestrator detecta el conflict del unique
 * parcial y NO crea duplicado.
 *
 * El path `eventKind: "whatsapp"` se eliminó en el cierre de 3b. La
 * detección de tibio ahora vive en `eventKind: "contact"` vía
 * `hasRecentInboundActivity`, alimentado por el contact lookup de
 * conversaciones por contactId (ver sync-ghl.ts).
 */

const TERMINAL_STATUSES: ReadonlySet<LeadStatus> = new Set<LeadStatus>([
  "cerrado",
  "perdido",
]);

/**
 * Orden de "calor" del status. Usamos esto para no degradar un lead: si ya
 * está en tibio y entra una señal de frio, no lo bajamos.
 */
const STATUS_ORDER: Record<LeadStatus, number> = {
  frio: 0,
  tibio: 1,
  agendado: 2,
  cerrado: 3,
  perdido: 3,
};

export type EventKind = "appointment" | "contact";

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
        source: "ghl";
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
  return createPayload(args, "agendado", true);
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
  return createPayload(args, targetStatus, pinned);
}

// ─── helper de create ──────────────────────────────────────────────────────

function createPayload(
  args: ResolveArgs,
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
      source: "ghl",
      status,
      pinned_to_kanban: pinned,
      external_id: args.externalId,
      notes: null,
      team_member_id: args.teamMemberId ?? null,
    },
  };
}
