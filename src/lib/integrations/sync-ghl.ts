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
 * Orquesta el sync de GHL — UNA ETAPA POR CORRIDA.
 *
 * Fase 3b post-mortem: las 3 etapas (appointments + conversations + contacts)
 * juntas excedían el timeout del Server Action en locations con mucho
 * histórico. Particionamos: un click del usuario = un stage. Cada stage tiene
 * su propio integration_run, su propio lastSuccessAt incremental, y termina
 * en pocos segundos.
 *
 * Optimización adicional: eliminamos `fetchGhlInboundMessageCount`. Antes
 * para clasificar WA frio vs tibio hacíamos hasta 10 páginas extra por
 * conversación — el cuello de botella principal. Ahora todos los WA nuevos
 * arrancan como 'frio'. La promoción a 'tibio' queda pendiente para una
 * mecánica futura (cron, botón aparte, etc.). El matcher NO degrada los
 * existentes en tibio, así que esto es seguro: solo demora la primera
 * promoción, no rompe el dato.
 */

type ServiceClient = ReturnType<typeof createServiceClient>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseClient = { from: (name: string) => any };
function loose(service: ServiceClient): LooseClient {
  return service as unknown as LooseClient;
}

export type GhlSyncStage = "appointments" | "conversations" | "contacts";

interface StageCounts {
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
}

export type GhlRunSummary =
  | {
      status: "success";
      stage: GhlSyncStage;
      counts: StageCounts;
      meta: AppointmentsMeta | ConversationsMeta | ContactsMeta;
    }
  | {
      status: "token_invalid" | "rate_limited" | "error";
      stage: GhlSyncStage;
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
  /** Cuál de las 3 etapas correr. Una por sync. */
  stage: GhlSyncStage;
  /** Inicio de la ventana del launch (YYYY-MM-DD). */
  since: string;
  /** Fin de la ventana del launch (YYYY-MM-DD). */
  until: string;
  /**
   * Sub-ventana para WhatsApp (etapa compra+cierre). Si null, conversations
   * usa `[since, until]` como fallback.
   */
  conversationsWindow?: { start: string; end: string } | null;
  /** ISO timestamp del último run exitoso DE ESTA STAGE. Null en la primera. */
  lastSuccessAt?: string | null;
}

export async function runGhlSync(args: RunGhlSyncArgs): Promise<GhlRunSummary> {
  switch (args.stage) {
    case "appointments":
      return await runAppointmentsStage(args);
    case "conversations":
      return await runConversationsStage(args);
    case "contacts":
      return await runContactsStage(args);
  }
}

// ─── stage: appointments ────────────────────────────────────────────────────

async function runAppointmentsStage(args: RunGhlSyncArgs): Promise<GhlRunSummary> {
  const country = (args.defaultCountry || "AR") as CountryCode;

  const apptResult = await fetchGhlAppointments({
    token: args.token,
    locationId: args.locationId,
    since: args.since,
    until: args.until,
  });
  if (!apptResult.ok) return propagateFailure(apptResult, "appointments");

  // Pre-locate en paralelo. El apply también va paralelo — applyAction es
  // self-contained y la DB aguanta concurrency 10 con holgura.
  const located = await parallelMap(apptResult.rows, 10, async (e) => {
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

  const counts = await applyAppointments(args, located);
  return { status: "success", stage: "appointments", counts, meta: apptResult.meta };
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
  // Antes era un for sequential — con 500 appointments y 50ms por DB call
  // eran 25s solo apply. Con concurrency 10 baja a 2-3s.
  const results = await parallelMap(items, 10, async (item) => {
    const action = resolveMatchAction({
      eventKind: "appointment",
      existing: item.existing,
      externalId: item.evt.id,
      contactName: item.evt.contactName,
      phoneNormalized: item.phoneNormalized,
      rawPhone: item.evt.rawPhone,
    });
    return await applyAction(args, action, buildAppointmentNotes(item.evt));
  });
  for (const r of results) accumulate(summary, r);
  return summary;
}

// ─── stage: conversations (WhatsApp) ────────────────────────────────────────

async function runConversationsStage(args: RunGhlSyncArgs): Promise<GhlRunSummary> {
  const country = (args.defaultCountry || "AR") as CountryCode;
  const convWindow = args.conversationsWindow ?? {
    start: args.since,
    end: args.until,
  };
  const cutoffIso = args.lastSuccessAt ?? null;

  const convResult = await fetchGhlConversations({
    token: args.token,
    locationId: args.locationId,
    since: convWindow.start,
    until: convWindow.end,
    cutoffIso,
  });
  if (!convResult.ok) return propagateFailure(convResult, "conversations");

  const located = await parallelMap(convResult.rows, 10, async (c) => {
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

  const counts = await applyConversations(args, located);
  return { status: "success", stage: "conversations", counts, meta: convResult.meta };
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
  // inboundMessageCount queda en null deliberadamente — ver doc del módulo.
  // El matcher trata null como "asumir frio". Eso degrada un poco la
  // clasificación inicial (un lead con 5 mensajes inbound entra como frio en
  // vez de tibio), pero el matcher no degrada los existentes en tibio así
  // que es safe: re-correr el sync no rompe el dato. La promoción a tibio
  // queda como follow-up.
  const results = await parallelMap(items, 10, async (item) => {
    const action = resolveMatchAction({
      eventKind: "whatsapp",
      existing: item.existing,
      externalId: item.conv.id,
      contactName: item.conv.contactName,
      phoneNormalized: item.phoneNormalized,
      rawPhone: item.conv.rawPhone,
      inboundMessageCount: null,
    });
    return await applyAction(args, action, buildConversationNotes(item.conv));
  });
  for (const r of results) accumulate(summary, r);
  return summary;
}

// ─── stage: contacts (formulario / CRM general) ─────────────────────────────

async function runContactsStage(args: RunGhlSyncArgs): Promise<GhlRunSummary> {
  const country = (args.defaultCountry || "AR") as CountryCode;
  const cutoffIso = args.lastSuccessAt ?? null;

  const contactsResult = await fetchGhlContacts({
    token: args.token,
    locationId: args.locationId,
    since: args.since,
    until: args.until,
    cutoffIso,
  });
  if (!contactsResult.ok) return propagateFailure(contactsResult, "contacts");

  const located = await parallelMap(contactsResult.rows, 10, async (c) => {
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

  const counts = await applyContacts(args, located);
  return { status: "success", stage: "contacts", counts, meta: contactsResult.meta };
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
  const results = await parallelMap(items, 10, async (item) => {
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
    return await applyAction(args, action, buildContactNotes(item.contact));
  });
  for (const r of results) accumulate(summary, r);
  return summary;
}

// ─── tipos located ─────────────────────────────────────────────────────────

interface LocatedAppointment {
  evt: GhlAppointment;
  phoneNormalized: string | null;
  existing: ExistingLeadView | null;
}

interface LocatedConversation {
  conv: GhlConversation;
  phoneNormalized: string | null;
  existing: ExistingLeadView | null;
}

interface LocatedContact {
  contact: GhlContact;
  phoneNormalized: string | null;
  existing: ExistingLeadView | null;
}

// ─── concurrency helper ────────────────────────────────────────────────────

/**
 * Procesa `items` con `concurrency` workers en paralelo. Mantiene el orden
 * del array de salida (idx-based slotting). No usa `Promise.all` directo
 * porque para 1000+ items eso dispararía 1000 fetches simultáneos contra
 * GHL/Supabase y nos van a tirar 429/connection exhaustion en segundos.
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

function propagateFailure(
  failure: GhlFetchFailure,
  stage: GhlSyncStage,
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
