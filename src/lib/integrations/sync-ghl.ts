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
 * Orquesta el sync de GHL en UNA corrida combinada con BULK operations.
 *
 * Razón del refactor (post-postmortem): a volumen alto (20k contacts) el sync
 * anterior hacía 2 queries de locate POR item + 1 insert/update POR item =
 * ~60k round-trips a Supabase. Aún con concurrency 10 eso tarda 5-10 min y
 * supera el timeout del Server Action.
 *
 * Ahora:
 *   1) UNA query por external_id IN (...) + UNA por phone IN (...) → Map en memoria
 *   2) BULK upsert por batches de 500 para los inserts (onConflict ignora duplicados).
 *   3) Updates individuales en paralelo, pero salteando los no-op (patch que
 *      no cambia nada respecto al existing).
 *
 * Se procesa en DOS fases serializadas: contacts primero, después appointments.
 * El segundo locate ve los leads recién creados por el primero, evitando que
 * un appointment del mismo contacto cree un lead duplicado.
 *
 * Reglas de clasificación (sin cambios respecto a la versión anterior):
 *   - tag 'cliente' → cerrado
 *   - tag 'tibio' O conversación WA con inbound reciente → tibio
 *   - default → frio
 *   - appointment confirmed → agendado (cancelled/noshow → noop)
 *   - assignedTo de GHL → team_member_id via ghl_user_mappings
 *   - no degrada: lead agendado/cerrado nunca baja
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
  since: string;
  until: string;
  /**
   * Sub-ventana compra+cierre. SOLO se usa para acotar la actividad inbound
   * que cuenta como "tibio". Si null, fallback a `[since, until]`.
   */
  warmWindow?: { start: string; end: string } | null;
  lastSuccessAt?: string | null;
}

const BULK_BATCH = 500;
const UPDATE_CONCURRENCY = 10;

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

  // 2) Fetches GHL en paralelo.
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

  // 3) Warm map (contactId → bool) a partir de conversaciones en compra+cierre.
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

  // 4) Preparar items de contacts (normalización de phones).
  let warmSignalsSeen = 0;
  let mappingsApplied = 0;

  const contactItems: PreparedContactItem[] = contactsResult.rows.map((c) => {
    const phoneNormalized = normalize(c.rawPhone, country);
    const hasClientTag = c.tags.some((t) => t.toLowerCase() === "cliente");
    const hasTibioTag = c.tags.some((t) => t.toLowerCase() === "tibio");
    const hasWarmConv = warmByContact.get(c.id) === true;
    const hasRecentInboundActivity = hasTibioTag || hasWarmConv;
    if (hasRecentInboundActivity) warmSignalsSeen++;

    let teamMemberId: string | null | undefined = undefined;
    if (c.assignedTo) {
      const tm = mappings.get(c.assignedTo) ?? null;
      teamMemberId = tm;
      if (tm) mappingsApplied++;
    }

    return {
      contact: c,
      phoneNormalized,
      hasClientTag,
      hasRecentInboundActivity,
      teamMemberId,
    };
  });

  // 5) Bulk locate de contacts: 1 query por external_id IN, 1 por phone IN.
  const contactExternalIds = contactItems.map((i) => i.contact.id);
  const contactPhones = contactItems
    .map((i) => i.phoneNormalized)
    .filter((p): p is string => Boolean(p));
  const contactLookup = await buildLeadLookup({
    service: args.service,
    projectId: args.projectId,
    source: "ghl",
    externalIds: contactExternalIds,
    phoneNormalizeds: contactPhones,
  });

  // 6) Classify contacts y separar inserts/updates.
  const contactActions = contactItems.map<ClassifiedAction>((item) => {
    const existing = lookup(contactLookup, "ghl", item.contact.id, item.phoneNormalized);
    const action = resolveMatchAction({
      eventKind: "contact",
      existing,
      externalId: item.contact.id,
      contactName: item.contact.contactName,
      phoneNormalized: item.phoneNormalized,
      rawPhone: item.contact.rawPhone,
      email: item.contact.email,
      hasClientTag: item.hasClientTag,
      hasRecentInboundActivity: item.hasRecentInboundActivity,
      teamMemberId: item.teamMemberId,
    });
    return { action, existing, notes: buildContactNotes(item.contact) };
  });
  const contactsCounts = await applyBulk(args, contactActions);

  // 7) Preparar appointments y locate (incluyendo leads recién creados arriba).
  const apptItems: PreparedApptItem[] = apptResult.rows.map((e) => ({
    appt: e,
    phoneNormalized: normalize(e.rawPhone, country),
  }));
  const apptExternalIds = apptItems.map((i) => i.appt.id);
  const apptPhones = apptItems
    .map((i) => i.phoneNormalized)
    .filter((p): p is string => Boolean(p));
  const apptLookup = await buildLeadLookup({
    service: args.service,
    projectId: args.projectId,
    source: "ghl",
    externalIds: apptExternalIds,
    phoneNormalizeds: apptPhones,
  });

  const apptActions = apptItems.map<ClassifiedAction>((item) => {
    const existing = lookup(apptLookup, "ghl", item.appt.id, item.phoneNormalized);
    const action = resolveMatchAction({
      eventKind: "appointment",
      existing,
      externalId: item.appt.id,
      contactName: item.appt.contactName,
      phoneNormalized: item.phoneNormalized,
      rawPhone: item.appt.rawPhone,
      appointmentStatus: item.appt.status,
    });
    return { action, existing, notes: buildAppointmentNotes(item.appt) };
  });
  const apptCounts = await applyBulk(args, apptActions);

  return {
    status: "success",
    counts: { contacts: contactsCounts, appointments: apptCounts },
    meta: {
      contacts: contactsResult.meta,
      appointments: apptResult.meta,
      conversations: convResult.meta,
      warm_signals_seen: warmSignalsSeen,
      mappings_applied: mappingsApplied,
    },
  };
}

// ─── tipos auxiliares ──────────────────────────────────────────────────────

interface PreparedContactItem {
  contact: GhlContact;
  phoneNormalized: string | null;
  hasClientTag: boolean;
  hasRecentInboundActivity: boolean;
  /** undefined = no setear team_member_id; null o string = setear ese valor. */
  teamMemberId: string | null | undefined;
}

interface PreparedApptItem {
  appt: GhlAppointment;
  phoneNormalized: string | null;
}

interface ClassifiedAction {
  action: MatchAction;
  existing: ExistingLeadView | null;
  notes: string | null;
}

interface LeadLookup {
  /** Key: `${source}:${externalId}` */
  byExternalKey: Map<string, ExistingLeadView>;
  /** Key: phone_normalized */
  byPhone: Map<string, ExistingLeadView>;
}

// ─── bulk locate ───────────────────────────────────────────────────────────

interface BuildLookupArgs {
  service: ServiceClient;
  projectId: string;
  source: "ghl" | "whatsapp";
  externalIds: ReadonlyArray<string>;
  phoneNormalizeds: ReadonlyArray<string>;
}

/**
 * Trae todos los leads que matchean external_id o phone con UNA sola query
 * cada uno. Postgres tolera IN (...) muy largos pero por las dudas chunkeamos
 * a 1000 ids por query (los pega varias y mergeamos). Para 20k items eso son
 * 40 round-trips totales — 1000× menos que el patrón viejo.
 */
async function buildLeadLookup(args: BuildLookupArgs): Promise<LeadLookup> {
  const byExternalKey = new Map<string, ExistingLeadView>();
  const byPhone = new Map<string, ExistingLeadView>();

  const externalIdChunks = chunk(uniqueStr(args.externalIds), 1000);
  const phoneChunks = chunk(uniqueStr(args.phoneNormalizeds), 1000);

  // Lanzamos todas las queries en paralelo (Promise.all) — pocas son.
  const queries: Promise<unknown>[] = [];

  for (const ids of externalIdChunks) {
    queries.push(
      (async () => {
        const res = await loose(args.service)
          .from("leads")
          .select(
            "id, status, pinned_to_kanban, external_id, source, phone_normalized, team_member_id",
          )
          .eq("project_id", args.projectId)
          .eq("source", args.source)
          .in("external_id", ids);
        for (const row of ((res.data ?? []) as LeadRowFromLookup[])) {
          const view = toExistingView(row);
          if (row.external_id) {
            byExternalKey.set(`${row.source}:${row.external_id}`, view);
          }
          if (row.phone_normalized) {
            // También indexamos por phone — un lead puede ser el match tanto
            // por external_id como por phone (ej. appointment del mismo contact).
            byPhone.set(row.phone_normalized, view);
          }
        }
      })(),
    );
  }

  for (const phones of phoneChunks) {
    queries.push(
      (async () => {
        // NOTA: el locate por phone NO filtra por source — un lead puede haber
        // entrado por import/manual y ahora vincularse a un evento de GHL.
        const res = await loose(args.service)
          .from("leads")
          .select(
            "id, status, pinned_to_kanban, external_id, source, phone_normalized, team_member_id",
          )
          .eq("project_id", args.projectId)
          .in("phone_normalized", phones)
          .order("created_at", { ascending: false });
        for (const row of ((res.data ?? []) as LeadRowFromLookup[])) {
          if (row.phone_normalized && !byPhone.has(row.phone_normalized)) {
            // Si ya hay match por external_id apuntando al mismo phone, no lo
            // pisamos. Como pedimos ordenado por created_at desc, el primer
            // row por phone es el más reciente (mismo criterio que el viejo).
            byPhone.set(row.phone_normalized, toExistingView(row));
          }
        }
      })(),
    );
  }

  await Promise.all(queries);
  return { byExternalKey, byPhone };
}

interface LeadRowFromLookup {
  id: string;
  status: ExistingLeadView["status"];
  pinned_to_kanban: boolean;
  external_id: string | null;
  source: string;
  phone_normalized: string | null;
  team_member_id: string | null;
}

function toExistingView(row: LeadRowFromLookup): ExistingLeadView {
  return {
    id: row.id,
    status: row.status,
    pinned_to_kanban: row.pinned_to_kanban,
    external_id: row.external_id,
    source: row.source,
    phone_normalized: row.phone_normalized,
    team_member_id: row.team_member_id,
  };
}

function lookup(
  l: LeadLookup,
  source: "ghl" | "whatsapp",
  externalId: string,
  phoneNormalized: string | null,
): ExistingLeadView | null {
  const byExt = l.byExternalKey.get(`${source}:${externalId}`);
  if (byExt) return byExt;
  if (!phoneNormalized) return null;
  return l.byPhone.get(phoneNormalized) ?? null;
}

// ─── bulk apply ────────────────────────────────────────────────────────────

/**
 * Recibe la lista de acciones clasificadas y las aplica:
 *   - `create` → batch upsert con onConflict (ignora duplicados)
 *   - `update` → individual, pero filtramos los no-op antes (patch que no
 *     cambia ningún campo del existing)
 *   - `noop` → cuenta como skipped
 */
async function applyBulk(
  args: RunGhlSyncArgs,
  items: ReadonlyArray<ClassifiedAction>,
): Promise<StageCounts> {
  const counts: StageCounts = {
    fetched: items.length,
    created: 0,
    updated: 0,
    skipped: 0,
  };

  // Separación
  const createPayloads: Record<string, unknown>[] = [];
  const updatesToRun: Array<{ leadId: string; patch: Record<string, unknown> }> = [];

  for (const item of items) {
    if (item.action.kind === "noop") {
      counts.skipped++;
      continue;
    }
    if (item.action.kind === "create") {
      createPayloads.push({
        ...item.action.payload,
        project_id: args.projectId,
        launch_id: args.launchId,
        notes: item.notes,
      });
      continue;
    }
    // update — filtrar no-op
    if (isNoopUpdate(item.action.patch, item.existing)) {
      counts.skipped++;
      continue;
    }
    updatesToRun.push({ leadId: item.action.leadId, patch: item.action.patch });
  }

  // Bulk insert por batches. NO podemos usar onConflict/upsert porque el unique
  // de leads es un índice parcial (`WHERE external_id IS NOT NULL`, ver 0017)
  // y PostgREST no permite pasar el WHERE del ON CONFLICT desde .upsert().
  // Acá no lo necesitamos: el locate bulk anterior nos garantiza que estos
  // payloads son leads nuevos. El 23505 solo es posible por una race condition
  // entre dos sincronizaciones simultáneas — el watchdog y el botón
  // deshabilitado mientras corre lo hacen extremadamente improbable. Si igual
  // ocurre, caemos a inserts uno-a-uno tolerando el 23505 silenciosamente.
  for (const batch of chunk(createPayloads, BULK_BATCH)) {
    const { data, error } = await loose(args.service)
      .from("leads")
      .insert(batch)
      .select("id");
    if (!error) {
      counts.created += ((data as Array<unknown>) ?? []).length;
      continue;
    }
    // Race con otra corrida (o un payload con phone duplicado que no
    // detectamos en el locate). Fallback robusto.
    const { created, skipped, failedError } = await insertOneByOne(
      args.service,
      batch,
    );
    if (failedError) {
      throw new Error(`GHL bulk insert leads: ${failedError}`);
    }
    counts.created += created;
    counts.skipped += skipped;
  }

  // Updates en paralelo con concurrency limitada. Aún son N round-trips pero
  // sólo de los leads que cambiaron algo — mucho menos que la versión vieja.
  const updateResults = await parallelMap(updatesToRun, UPDATE_CONCURRENCY, async (u) => {
    const { error } = await loose(args.service)
      .from("leads")
      .update(u.patch)
      .eq("id", u.leadId);
    if (error) throw new Error(`GHL update lead: ${error.message}`);
    return true;
  });
  counts.updated += updateResults.length;

  return counts;
}

/**
 * Fallback cuando el bulk insert de un batch falla por un único 23505 (race
 * con otra corrida). Hace inserts uno a uno tolerando el 23505 como "skipped".
 * Cualquier OTRO error se propaga via `failedError`.
 *
 * Performance: solo se usa cuando el batch entero falla. En operación normal
 * esto NUNCA se llama, porque el locate bulk previo asegura que los creates
 * son leads nuevos.
 */
async function insertOneByOne(
  service: ServiceClient,
  batch: ReadonlyArray<Record<string, unknown>>,
): Promise<{ created: number; skipped: number; failedError: string | null }> {
  let created = 0;
  let skipped = 0;
  const results = await parallelMap(batch, UPDATE_CONCURRENCY, async (row) => {
    const { error } = await loose(service).from("leads").insert(row);
    if (!error) return { kind: "created" as const };
    if (error.code === "23505") return { kind: "skipped" as const };
    return { kind: "failed" as const, message: error.message as string };
  });
  for (const r of results) {
    if (r.kind === "created") created++;
    else if (r.kind === "skipped") skipped++;
    else return { created, skipped, failedError: r.message };
  }
  return { created, skipped, failedError: null };
}

/**
 * Detecta cuándo un update no cambia nada: el patch trae sólo campos que ya
 * son iguales en el existing. Ahorra round-trips a Supabase — para sync
 * repetido sin cambios reales, esto baja los updates de 5000 a ~0.
 */
function isNoopUpdate(
  patch: Record<string, unknown>,
  existing: ExistingLeadView | null,
): boolean {
  if (!existing) return false;
  // Si algún campo del patch difiere de existing → no es noop.
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const currentValue = (existing as unknown as Record<string, unknown>)[key];
    if (currentValue !== value) return false;
  }
  return true;
}

// ─── concurrency helper ────────────────────────────────────────────────────

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

function chunk<T>(arr: ReadonlyArray<T>, size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function uniqueStr(arr: ReadonlyArray<string>): string[] {
  return Array.from(new Set(arr));
}

// ─── helpers comunes ───────────────────────────────────────────────────────

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
