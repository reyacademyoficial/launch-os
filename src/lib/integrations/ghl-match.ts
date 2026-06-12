import "server-only";

import type { LeadStatus } from "@/lib/leads/types";

/**
 * Reglas de transición cuando un evento de GHL matchea (o no) con un lead
 * existente. Función pura: recibe el lead actual (o null) + tipo de evento y
 * devuelve qué acción tomar. El orchestrator ejecuta el INSERT/UPDATE.
 *
 * Brief Fase 3b:
 *   - Appointment matcheado a lead existente:
 *     · status terminal (cerrado/perdido) → no toco status ni promociono.
 *     · status no terminal → pasa a "agendado" + pinned_to_kanban=true.
 *   - Appointment sin match → crear lead con source='ghl', status='agendado',
 *     pinned=true.
 *   - Conversación WhatsApp matcheada → SOLO pin to kanban (status no cambia,
 *     una conversación es señal de actividad, no de etapa).
 *   - Conversación sin match → crear lead con source='whatsapp',
 *     status='nuevo', pinned=true.
 *
 * Idempotencia: si el `external_id` del evento ya está vinculado a un lead
 * con el mismo `source`, el orchestrator detecta el conflict del unique
 * parcial y NO crea otro lead.
 */

const TERMINAL_STATUSES: ReadonlySet<LeadStatus> = new Set<LeadStatus>([
  "cerrado",
  "perdido",
]);

export type EventKind = "appointment" | "whatsapp";

/** Subset del LeadRow que las reglas necesitan saber. */
export interface ExistingLeadView {
  id: string;
  status: LeadStatus;
  pinned_to_kanban: boolean;
}

/**
 * Acción a aplicar. Una de tres:
 *   - "create"  → INSERT nuevo lead con el payload provisto.
 *   - "update"  → UPDATE el lead identificado por `leadId` con el patch.
 *   - "noop"    → no hago nada (caso lead terminal + appointment).
 */
export type MatchAction =
  | {
      kind: "create";
      payload: {
        name: string;
        phone_normalized: string | null;
        contact: string | null;
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

interface ResolveArgs {
  eventKind: EventKind;
  existing: ExistingLeadView | null;
  externalId: string;
  contactName: string;
  phoneNormalized: string | null;
  rawPhone: string | null;
}

export function resolveMatchAction(args: ResolveArgs): MatchAction {
  const { eventKind, existing, externalId } = args;

  if (existing) {
    if (eventKind === "appointment") {
      if (TERMINAL_STATUSES.has(existing.status)) {
        return { kind: "noop", reason: "lead_terminal" };
      }
      // Si ya estaba "agendado" y pinned, igual aprovechamos para refrescar
      // el external_id (último appointment vinculado). Es trivial y permite
      // detectar el siguiente sync por external_id.
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
    // WhatsApp: NO cambio status. Solo pin (si no estaba) + external_id.
    return {
      kind: "update",
      leadId: existing.id,
      patch: {
        pinned_to_kanban: true,
        external_id: externalId,
      },
    };
  }

  // Sin lead previo → crear.
  const source = eventKind === "appointment" ? "ghl" : "whatsapp";
  const status: LeadStatus = eventKind === "appointment" ? "agendado" : "nuevo";
  return {
    kind: "create",
    payload: {
      name: args.contactName,
      phone_normalized: args.phoneNormalized,
      // `contact` queda como display fallback — guardamos el teléfono raw
      // si no se pudo normalizar (sino seguiría siendo invisible para el
      // usuario).
      contact: args.phoneNormalized ? null : args.rawPhone,
      source,
      status,
      pinned_to_kanban: true,
      external_id: externalId,
      notes: null,
    },
  };
}
