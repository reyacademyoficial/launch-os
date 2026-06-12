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

  // Pre-locate en paralelo, después apply secuencial.
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
  const apptSummary = await applyAppointments(args, apptLocated);

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

  // Locate primero (en paralelo) para saber qué leads ya existen, qué
  // estado tienen y decidir si vale la pena contar mensajes para cada uno.
  // Si el lead ya está en tibio/agendado/cerrado/perdido, contar inbound
  // no cambia nada — saltamos el fetch (es el cuello de botella principal).
  const convLocated = await parallelMap(convResult.rows, 10, async (c) => {
    const phoneNormalized = normalize(c.rawPhone, country);
    const existing = await locateLead({
      service: args.service,
      projectId: args.projectId,
      source: "whatsapp",
      externalId: c.id,
      phoneNormalized,
    });
    return { conv: c, phoneNormalized, existing };
  });

  // Contamos inbound solo donde el resultado importa.
  const convWithCounts = await parallelMap(convLocated, 10, async (item) => {
    const count = shouldCountMessages(item.existing)
      ? await fetchGhlInboundMessageCount(args.token, item.conv.id)
      : null;
    return { ...item, inboundCount: count };
  });

  const convSummary = await applyConversations(args, convWithCounts);

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
  const contactsSummary = await applyContacts(args, contactsLocated);

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

// ─── apply (post-locate) ───────────────────────────────────────────────────

interface LocatedAppointment {
  evt: GhlAppointment;
  phoneNormalized: string | null;
  existing: ExistingLeadView | null;
}

interface LocatedConversation {
  conv: GhlConversation;
  phoneNormalized: string | null;
  existing: ExistingLeadView | null;
  inboundCount: number | null;
}

interface LocatedContact {
  contact: GhlContact;
  phoneNormalized: string | null;
  existing: ExistingLeadView | null;
}

async function applyAppointments(
  args: RunGhlSyncArgs,
  items: ReadonlyArray<LocatedAppointment>,
): Promise<StageCounts> {
  const summary: StageCounts = {
    fetched: items.length,
    created: 0,
    updated: 0,
    skipped: 0,
  };
  for (const item of items) {
    const action = resolveMatchAction({
      eventKind: "appointment",
      existing: item.existing,
      externalId: item.evt.id,
      contactName: item.evt.contactName,
      phoneNormalized: item.phoneNormalized,
      rawPhone: item.evt.rawPhone,
    });
    const applied = await applyAction(args, action, buildAppointmentNotes(item.evt));
    accumulate(summary, applied);
  }
  return summary;
}

async function applyConversations(
  args: RunGhlSyncArgs,
  items: ReadonlyArray<LocatedConversation>,
): Promise<StageCounts> {
  const summary: StageCounts = {
    fetched: items.length,
    created: 0,
    updated: 0,
    skipped: 0,
  };
  for (const item of items) {
    const action = resolveMatchAction({
      eventKind: "whatsapp",
      existing: item.existing,
      externalId: item.conv.id,
      contactName: item.conv.contactName,
      phoneNormalized: item.phoneNormalized,
      rawPhone: item.conv.rawPhone,
      inboundMessageCount: item.inboundCount,
    });
    const applied = await applyAction(args, action, buildConversationNotes(item.conv));
    accumulate(summary, applied);
  }
  return summary;
}

async function applyContacts(
  args: RunGhlSyncArgs,
  items: ReadonlyArray<LocatedContact>,
): Promise<StageCounts> {
  const summary: StageCounts = {
    fetched: items.length,
    created: 0,
    updated: 0,
    skipped: 0,
  };
  for (const item of items) {
    const hasClientTag = item.contact.tags.some(
      (t) => t.toLowerCase() === "cliente",
    );
    const action = resolveMatchAction({
      eventKind: "contact",
      existing: item.existing,
      externalId: item.contact.id,
      contactName: item.contact.contactName,
      phoneNormalized: item.phoneNormalized,
      rawPhone: item.contact.rawPhone,
      email: item.contact.email,
      hasClientTag,
    });
    const applied = await applyAction(args, action, buildContactNotes(item.contact));
    accumulate(summary, applied);
  }
  return summary;
}

// ─── concurrency helper ────────────────────────────────────────────────────

/**
 * Procesa `items` con `concurrency` workers en paralelo. Mantiene el orden
 * del array de salida (idx-based slotting). No usa `Promise.all` directo
 * porque para 1000+ items eso dispararía 1000 fetches simultáneos contra
 * GHL y nos van a tirar 429 en segundos.
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

/**
 * Decide si vale la pena gastar un fetch para contar mensajes inbound. La
 * respuesta cambia el `status` solo si el lead va a ser nuevo o está en frío
 * (puede subir a tibio). Si ya está en tibio/agendado/cerrado/perdido, el
 * conteo no afecta — ahorramos el fetch.
 */
function shouldCountMessages(existing: ExistingLeadView | null): boolean {
  if (!existing) return true;
  return existing.status === "frio";
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
