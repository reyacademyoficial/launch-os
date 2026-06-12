import "server-only";

import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

import {
  fetchGhlAppointments,
  fetchGhlContacts,
  fetchGhlConversations,
  fetchGhlInboundMessageCount,
  type AppointmentsMeta,
  type ContactsMeta,
  type ConversationsMeta,
  type GhlAppointment,
  type GhlContact,
  type GhlConversation,
  type GhlFetchFailure,
} from "./ghl";
import {
  resolveMatchAction,
  type EventKind,
  type ExistingLeadView,
  type MatchAction,
} from "./ghl-match";

import type { createServiceClient } from "@/lib/supabase/service";

/**
 * Orquesta el sync de GHL: appointments + conversations (WhatsApp) +
 * contacts (formulario / CRM). Cada rama tiene su ventana propia y se hace
 * incremental contra el último run exitoso.
 *
 * Ventanas:
 *   - appointments: [date_start, date_end] del launch (toda la ventana).
 *   - conversations (WhatsApp): rango [inicio_compra, fin_cierre] del
 *     calendario (fase 2b). Fallback a [date_start, date_end] si el launch
 *     no tiene `launch_date` cargado.
 *   - contacts: [date_start, date_end] del launch.
 *
 * Incremental: el caller pasa `lastSyncAt` (el started_at del último run
 * success). El adapter pagina con cortocircuito por fecha — no reprocesa
 * lo que ya entró.
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

export type GhlRunSummary =
  | {
      status: "success";
      appointments: StageCounts;
      conversations: StageCounts;
      contacts: StageCounts;
      appointmentsMeta: AppointmentsMeta;
      conversationsMeta: ConversationsMeta;
      contactsMeta: ContactsMeta;
    }
  | {
      status: "partial";
      appointments: StageCounts;
      conversations: StageCounts;
      contacts: StageCounts;
      appointmentsMeta: AppointmentsMeta;
      partialError: {
        stage: "conversations" | "contacts";
        kind: "token_invalid" | "rate_limited" | "error";
        message: string;
        detail: Record<string, unknown>;
      };
    }
  | {
      status: "token_invalid" | "rate_limited" | "error";
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
   * Sub-ventana para WhatsApp (etapa compra+cierre). Si null, conversations
   * usa `[since, until]` como fallback.
   */
  conversationsWindow?: { start: string; end: string } | null;
  /** ISO timestamp del último run exitoso. Null en la primera corrida. */
  lastSuccessAt?: string | null;
}

export async function runGhlSync(args: RunGhlSyncArgs): Promise<GhlRunSummary> {
  const country = (args.defaultCountry || "AR") as CountryCode;
  const convWindow = args.conversationsWindow ?? {
    start: args.since,
    end: args.until,
  };
  const cutoffIso = args.lastSuccessAt ?? null;

  // ─── 1) Appointments ─────────────────────────────────────────────────────
  const apptResult = await fetchGhlAppointments({
    token: args.token,
    locationId: args.locationId,
    since: args.since,
    until: args.until,
  });
  if (!apptResult.ok) return propagateFailure(apptResult);

  const apptSummary = await processBatch(
    args,
    "appointment",
    apptResult.rows,
    country,
    (e) => e.id,
    (e) => e.contactName,
    (e) => e.rawPhone,
    () => null,
    (e) => buildAppointmentNotes(e),
  );

  // ─── 2) Conversations (WhatsApp) ─────────────────────────────────────────
  const convResult = await fetchGhlConversations({
    token: args.token,
    locationId: args.locationId,
    since: convWindow.start,
    until: convWindow.end,
    cutoffIso,
  });
  if (!convResult.ok) {
    return {
      status: "partial",
      appointments: apptSummary,
      conversations: emptyCounts(),
      contacts: emptyCounts(),
      appointmentsMeta: apptResult.meta,
      partialError: {
        stage: "conversations",
        kind: convResult.kind,
        message: convResult.message,
        detail: convResult.detail,
      },
    };
  }

  // Para cada conversation, contamos inbound (mensajes del lead). Frío vs
  // tibio. Si el conteo falla, fallback a 1 (lo trata como frío).
  const convWithCounts = await Promise.all(
    convResult.rows.map(async (c) => {
      const count = await fetchGhlInboundMessageCount(args.token, c.id);
      return { conv: c, inboundCount: count };
    }),
  );

  const convSummary = await processBatchWithCount(
    args,
    "whatsapp",
    convWithCounts,
    country,
    (x) => x.conv.id,
    (x) => x.conv.contactName,
    (x) => x.conv.rawPhone,
    () => null,
    (x) => buildConversationNotes(x.conv),
    (x) => x.inboundCount,
  );

  // ─── 3) Contacts (formulario / CRM general) ──────────────────────────────
  const contactsResult = await fetchGhlContacts({
    token: args.token,
    locationId: args.locationId,
    since: args.since,
    until: args.until,
    cutoffIso,
  });
  if (!contactsResult.ok) {
    return {
      status: "partial",
      appointments: apptSummary,
      conversations: convSummary,
      contacts: emptyCounts(),
      appointmentsMeta: apptResult.meta,
      partialError: {
        stage: "contacts",
        kind: contactsResult.kind,
        message: contactsResult.message,
        detail: contactsResult.detail,
      },
    };
  }

  const contactsSummary = await processBatchContact(
    args,
    contactsResult.rows,
    country,
  );

  return {
    status: "success",
    appointments: apptSummary,
    conversations: convSummary,
    contacts: contactsSummary,
    appointmentsMeta: apptResult.meta,
    conversationsMeta: convResult.meta,
    contactsMeta: contactsResult.meta,
  };
}

// ─── processBatch (appointment) ────────────────────────────────────────────

async function processBatch<T>(
  args: RunGhlSyncArgs,
  eventKind: EventKind,
  rows: ReadonlyArray<T>,
  country: CountryCode,
  getId: (r: T) => string,
  getName: (r: T) => string,
  getPhone: (r: T) => string | null,
  getEmail: (r: T) => string | null,
  getNotes: (r: T) => string | null,
): Promise<StageCounts> {
  const summary: StageCounts = {
    fetched: rows.length,
    created: 0,
    updated: 0,
    skipped: 0,
  };
  const source: "ghl" | "whatsapp" =
    eventKind === "whatsapp" ? "whatsapp" : "ghl";

  for (const row of rows) {
    const externalId = getId(row);
    const rawPhone = getPhone(row);
    const phoneNormalized = normalize(rawPhone, country);
    const existing = await locateLead({
      service: args.service,
      projectId: args.projectId,
      source,
      externalId,
      phoneNormalized,
    });
    const action = resolveMatchAction({
      eventKind,
      existing,
      externalId,
      contactName: getName(row),
      phoneNormalized,
      rawPhone,
      email: getEmail(row),
    });
    const applied = await applyAction(args, action, getNotes(row));
    accumulate(summary, applied);
  }
  return summary;
}

// ─── processBatchWithCount (whatsapp con conteo de mensajes) ───────────────

async function processBatchWithCount<T>(
  args: RunGhlSyncArgs,
  eventKind: EventKind,
  rows: ReadonlyArray<T>,
  country: CountryCode,
  getId: (r: T) => string,
  getName: (r: T) => string,
  getPhone: (r: T) => string | null,
  getEmail: (r: T) => string | null,
  getNotes: (r: T) => string | null,
  getInboundCount: (r: T) => number | null,
): Promise<StageCounts> {
  const summary: StageCounts = {
    fetched: rows.length,
    created: 0,
    updated: 0,
    skipped: 0,
  };
  const source: "ghl" | "whatsapp" =
    eventKind === "whatsapp" ? "whatsapp" : "ghl";

  for (const row of rows) {
    const externalId = getId(row);
    const rawPhone = getPhone(row);
    const phoneNormalized = normalize(rawPhone, country);
    const existing = await locateLead({
      service: args.service,
      projectId: args.projectId,
      source,
      externalId,
      phoneNormalized,
    });
    const action = resolveMatchAction({
      eventKind,
      existing,
      externalId,
      contactName: getName(row),
      phoneNormalized,
      rawPhone,
      email: getEmail(row),
      inboundMessageCount: getInboundCount(row),
    });
    const applied = await applyAction(args, action, getNotes(row));
    accumulate(summary, applied);
  }
  return summary;
}

// ─── processBatchContact (contacts del CRM) ────────────────────────────────

async function processBatchContact(
  args: RunGhlSyncArgs,
  rows: ReadonlyArray<GhlContact>,
  country: CountryCode,
): Promise<StageCounts> {
  const summary: StageCounts = {
    fetched: rows.length,
    created: 0,
    updated: 0,
    skipped: 0,
  };

  for (const row of rows) {
    const externalId = row.id;
    const rawPhone = row.rawPhone;
    const phoneNormalized = normalize(rawPhone, country);
    const hasClientTag = row.tags.some((t) => t.toLowerCase() === "cliente");
    const existing = await locateLead({
      service: args.service,
      projectId: args.projectId,
      source: "ghl",
      externalId,
      phoneNormalized,
    });
    const action = resolveMatchAction({
      eventKind: "contact",
      existing,
      externalId,
      contactName: row.contactName,
      phoneNormalized,
      rawPhone,
      email: row.email,
      hasClientTag,
    });
    const applied = await applyAction(args, action, buildContactNotes(row));
    accumulate(summary, applied);
  }
  return summary;
}

// ─── locate (external_id O phone) ──────────────────────────────────────────

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
  // No filtramos por source — un lead puede haber entrado por import/manual
  // y ahora vincularse a un evento de GHL.
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

// ─── apply (INSERT / UPDATE) ───────────────────────────────────────────────

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

// ─── helpers ───────────────────────────────────────────────────────────────

function emptyCounts(): StageCounts {
  return { fetched: 0, created: 0, updated: 0, skipped: 0 };
}

function accumulate(s: StageCounts, kind: "created" | "updated" | "skipped") {
  if (kind === "created") s.created++;
  else if (kind === "updated") s.updated++;
  else s.skipped++;
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

function buildConversationNotes(c: GhlConversation): string | null {
  if (!c.lastMessageDate) return null;
  return `GHL ${c.type ?? "WhatsApp"} conversación ${c.id} — último mensaje ${c.lastMessageDate}`;
}

function buildContactNotes(c: GhlContact): string | null {
  if (!c.dateAdded) return null;
  return `GHL contact ${c.id} — creado ${c.dateAdded}`;
}

function propagateFailure(failure: GhlFetchFailure): GhlRunSummary {
  return {
    status: failure.kind,
    message: failure.message,
    detail: failure.detail,
    retryAfterSeconds: failure.retryAfterSeconds ?? null,
  };
}

function isUniqueViolation(code: string | undefined): boolean {
  return code === "23505";
}
