import "server-only";

import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

import {
  fetchGhlAppointments,
  fetchGhlContacts,
  fetchGhlConversations,
  type AppointmentsMeta,
  type ContactsMeta,
  type ConversationsMeta,
  type GhlAppointment,
  type GhlContact,
  type GhlFetchFailure,
} from "./ghl";
import {
  resolveMatchAction,
  type ExistingLeadView,
  type MatchAction,
} from "./ghl-match";

import type { createServiceClient } from "@/lib/supabase/service";

/**
 * Orquesta el sync de GHL en UNA corrida combinada:
 *   1) Carga mappings GHL user → team_member del proyecto.
 *   2) Trae contacts + appointments + conversations (lista WhatsApp) en paralelo.
 *   3) Arma un mapa contactId → tieneActividadInbound dentro de la ventana
 *      compra+cierre (señal de tibio).
 *   4) Apply contacts: status según tags/actividad/cliente + team_member del
 *      mapping. parallelMap concurrency 10.
 *   5) Apply appointments: solo los confirmed (no cancelled/noshow).
 *
 * Una sola corrida → una fila en integration_runs (stage='all'). Si una sub-
 * fase falla por token/rate, abortamos completo. La idempotencia la garantiza
 * el unique parcial sobre (project_id, source, external_id) — re-correr
 * completa sin duplicar.
 *
 * Por qué no `fetchGhlInboundMessageCount` más: contaba mensajes 1 por 1, era
 * el cuello de botella. Ahora la señal de tibio sale de `lastMessageDate +
 * lastMessageType` o `unreadCount` de la lista de conversations — barato.
 */

type ServiceClient = ReturnType<typeof createServiceClient>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseClient = { from: (name: string) => any };
function loose(service: ServiceClient): LooseClient {
  return service as unknown as LooseClient;
}

interface StageCounts {
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
}

export interface GhlCombinedCounts {
  contacts: StageCounts;
  appointments: StageCounts;
}

export type GhlRunSummary =
  | {
      status: "success";
      counts: GhlCombinedCounts;
      meta: {
        contacts: ContactsMeta;
        appointments: AppointmentsMeta;
        conversations: ConversationsMeta;
        warm_signals_seen: number;
        mappings_applied: number;
      };
    }
  | {
      status: "token_invalid" | "rate_limited" | "error";
      stage: "contacts" | "appointments" | "conversations" | "mappings";
      message: string;
      detail: Record<string, unknown>;
      retryAfterSeconds?: number | null;
    };

export interface RunGhlSyncArgs {
  service: ServiceClient;
  token: string;
  locationId: string;
  defaultCountry: string;
  projectId: string;
  launchId: string;
  /** Inicio de la ventana del launch (YYYY-MM-DD). */
  since: string;
  /** Fin de la ventana del launch (YYYY-MM-DD). */
  until: string;
  /**
   * Sub-ventana compra+cierre. SOLO se usa para acotar la actividad inbound
   * que cuenta como "tibio". Si null, fallback a `[since, until]`.
   */
  warmWindow?: { start: string; end: string } | null;
  /** ISO timestamp del último run exitoso (para el cutoff de paginación). */
  lastSuccessAt?: string | null;
}

export async function runGhlSync(args: RunGhlSyncArgs): Promise<GhlRunSummary> {
  const country = (args.defaultCountry || "AR") as CountryCode;
  const warmWindow = args.warmWindow ?? { start: args.since, end: args.until };
  const cutoffIso = args.lastSuccessAt ?? null;

  // 1) Mappings GHL user → team_member del proyecto.
  const mappingRes = await loose(args.service)
    .from("ghl_user_mappings")
    .select("ghl_user_id, team_member_id")
    .eq("project_id", args.projectId);
  if (mappingRes.error) {
    return {
      status: "error",
      stage: "mappings",
      message: `No pude leer ghl_user_mappings: ${mappingRes.error.message}`,
      detail: { code: mappingRes.error.code ?? null },
    };
  }
  const mappings = new Map<string, string>(
    ((mappingRes.data ?? []) as Array<{ ghl_user_id: string; team_member_id: string }>).map(
      (m) => [m.ghl_user_id, m.team_member_id],
    ),
  );

  // 2) Fetches en paralelo — independientes entre sí, cero razón para serializarlos.
  const [contactsResult, apptResult, convResult] = await Promise.all([
    fetchGhlContacts({
      token: args.token,
      locationId: args.locationId,
      since: args.since,
      until: args.until,
      cutoffIso,
    }),
    fetchGhlAppointments({
      token: args.token,
      locationId: args.locationId,
      since: args.since,
      until: args.until,
    }),
    fetchGhlConversations({
      token: args.token,
      locationId: args.locationId,
      since: warmWindow.start,
      until: warmWindow.end,
      cutoffIso,
    }),
  ]);
  if (!contactsResult.ok) return propagateFailure(contactsResult, "contacts");
  if (!apptResult.ok) return propagateFailure(apptResult, "appointments");
  if (!convResult.ok) return propagateFailure(convResult, "conversations");

  // 3) Tibio map: contactId → bool. "Tibio" si tiene conversación WhatsApp
  // con lastMessageDate en warmWindow Y (lastMessageType es inbound O
  // unreadCount > 0). lastMessageType de GHL puede emitir "TYPE_WHATSAPP_INBOUND"
  // o variantes — chequeamos por substring "inbound" case-insensitive.
  const warmStartMs = Date.parse(`${warmWindow.start}T00:00:00.000Z`);
  const warmEndMs = Date.parse(`${warmWindow.end}T23:59:59.999Z`);
  const warmByContact = new Map<string, boolean>();
  for (const c of convResult.rows) {
    if (!c.contactId) continue;
    const ms = c.lastMessageDate ? Date.parse(c.lastMessageDate) : NaN;
    if (!Number.isFinite(ms) || ms < warmStartMs || ms > warmEndMs) continue;
    const isInboundLast =
      typeof c.lastMessageType === "string" &&
      c.lastMessageType.toLowerCase().includes("inbound");
    const hasUnread = (c.unreadCount ?? 0) > 0;
    if (isInboundLast || hasUnread) warmByContact.set(c.contactId, true);
  }

  // 4) Apply contacts en paralelo.
  let warmSignalsSeen = 0;
  let mappingsApplied = 0;
  const contactsLocated = await parallelMap(contactsResult.rows, 10, async (c) => {
    const phoneNormalized = normalize(c.rawPhone, country);
    const existing = await locateLead({
      service: args.service,
      projectId: args.projectId,
      source: "ghl",
      externalId: c.id,
      phoneNormalized,
    });
    return { contact: c, phoneNormalized, existing };
  });

  const contactsCounts = await parallelMap(contactsLocated, 10, async (item) => {
    const hasClientTag = item.contact.tags.some(
      (t) => t.toLowerCase() === "cliente",
    );
    const hasTibioTag = item.contact.tags.some(
      (t) => t.toLowerCase() === "tibio",
    );
    const hasWarmConv = warmByContact.get(item.contact.id) === true;
    // Tag manual `tibio` O señal automática de WA → tibio.
    const hasRecentInboundActivity = hasTibioTag || hasWarmConv;
    if (hasRecentInboundActivity) warmSignalsSeen++;

    const teamMemberId = item.contact.assignedTo
      ? (mappings.get(item.contact.assignedTo) ?? null)
      : null;
    if (item.contact.assignedTo && teamMemberId) mappingsApplied++;

    const action = resolveMatchAction({
      eventKind: "contact",
      existing: item.existing,
      externalId: item.contact.id,
      contactName: item.contact.contactName,
      phoneNormalized: item.phoneNormalized,
      rawPhone: item.contact.rawPhone,
      email: item.contact.email,
      hasClientTag,
      hasRecentInboundActivity,
      teamMemberId: item.contact.assignedTo ? teamMemberId : undefined,
    });
    return await applyAction(args, action, buildContactNotes(item.contact));
  });
  const contactsSummary = countCounts(contactsResult.rows.length, contactsCounts);

  // 5) Apply appointments en paralelo. La traducción de vendedor sale del
  // contact con el mismo contactId — pero appointments no trae assignedTo
  // directo. Aceptable: el contact ya seteó el team_member_id en la fase
  // anterior, el appointment solo escala el status a 'agendado'.
  const apptLocated = await parallelMap(apptResult.rows, 10, async (e) => {
    const phoneNormalized = normalize(e.rawPhone, country);
    const existing = await locateLead({
      service: args.service,
      projectId: args.projectId,
      source: "ghl",
      externalId: e.id,
      phoneNormalized,
    });
    return { evt: e, phoneNormalized, existing };
  });

  const apptCounts = await parallelMap(apptLocated, 10, async (item) => {
    const action = resolveMatchAction({
      eventKind: "appointment",
      existing: item.existing,
      externalId: item.evt.id,
      contactName: item.evt.contactName,
      phoneNormalized: item.phoneNormalized,
      rawPhone: item.evt.rawPhone,
      appointmentStatus: item.evt.status,
    });
    return await applyAction(args, action, buildAppointmentNotes(item.evt));
  });
  const apptSummary = countCounts(apptResult.rows.length, apptCounts);

  return {
    status: "success",
    counts: { contacts: contactsSummary, appointments: apptSummary },
    meta: {
      contacts: contactsResult.meta,
      appointments: apptResult.meta,
      conversations: convResult.meta,
      warm_signals_seen: warmSignalsSeen,
      mappings_applied: mappingsApplied,
    },
  };
}

// ─── helpers ───────────────────────────────────────────────────────────────

function countCounts(
  fetched: number,
  results: ReadonlyArray<"created" | "updated" | "skipped">,
): StageCounts {
  const out: StageCounts = { fetched, created: 0, updated: 0, skipped: 0 };
  for (const r of results) {
    if (r === "created") out.created++;
    else if (r === "updated") out.updated++;
    else out.skipped++;
  }
  return out;
}

/**
 * Procesa `items` con `concurrency` workers en paralelo. Mantiene orden por
 * idx para no perder asociación caller-side. No usa Promise.all directo
 * para evitar disparar 1000+ requests simultáneos contra GHL/Supabase.
 */
async function parallelMap<T, R>(
  items: ReadonlyArray<T>,
  concurrency: number,
  fn: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}

async function locateLead(args: {
  service: ServiceClient;
  projectId: string;
  source: "ghl" | "whatsapp";
  externalId: string;
  phoneNormalized: string | null;
}): Promise<ExistingLeadView | null> {
  const byExternal = await loose(args.service)
    .from("leads")
    .select("id, status, pinned_to_kanban")
    .eq("project_id", args.projectId)
    .eq("source", args.source)
    .eq("external_id", args.externalId)
    .maybeSingle();
  if (byExternal.data) return byExternal.data as ExistingLeadView;

  if (!args.phoneNormalized) return null;
  const byPhone = await loose(args.service)
    .from("leads")
    .select("id, status, pinned_to_kanban")
    .eq("project_id", args.projectId)
    .eq("phone_normalized", args.phoneNormalized)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (byPhone.data) return byPhone.data as ExistingLeadView;
  return null;
}

async function applyAction(
  args: RunGhlSyncArgs,
  action: MatchAction,
  notes: string | null,
): Promise<"created" | "updated" | "skipped"> {
  if (action.kind === "noop") return "skipped";

  if (action.kind === "create") {
    const insertPayload = {
      ...action.payload,
      project_id: args.projectId,
      launch_id: args.launchId,
      notes,
    };
    const { error } = await loose(args.service).from("leads").insert(insertPayload);
    if (error) {
      if (isUniqueViolation(error.code)) return "skipped";
      throw new Error(`GHL insert lead: ${error.message}`);
    }
    return "created";
  }

  const { error } = await loose(args.service)
    .from("leads")
    .update(action.patch)
    .eq("id", action.leadId);
  if (error) throw new Error(`GHL update lead: ${error.message}`);
  return "updated";
}

function normalize(raw: string | null, country: CountryCode): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const parsed = parsePhoneNumberFromString(trimmed, country);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.format("E.164");
}

function buildAppointmentNotes(e: GhlAppointment): string | null {
  if (!e.startTime) return null;
  return `GHL appointment ${e.id} — comienza ${e.startTime}`;
}

function buildContactNotes(c: GhlContact): string | null {
  if (!c.dateAdded) return null;
  return `GHL contact ${c.id} — creado ${c.dateAdded}`;
}

function propagateFailure(
  failure: GhlFetchFailure,
  stage: "contacts" | "appointments" | "conversations" | "mappings",
): GhlRunSummary {
  return {
    status: failure.kind,
    stage,
    message: failure.message,
    detail: failure.detail,
    retryAfterSeconds: failure.retryAfterSeconds ?? null,
  };
}

function isUniqueViolation(code: string | undefined): boolean {
  return code === "23505";
}
