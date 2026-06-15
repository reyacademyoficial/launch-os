import "server-only";

import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

import {
  fetchGhlAppointments,
  fetchGhlContactConversations,
  fetchGhlContacts,
  fetchGhlOpportunities,
  type AppointmentsMeta,
  type ContactsMeta,
  type GhlAppointment,
  type GhlContact,
  type GhlFetchFailure,
  type GhlOpportunity,
  type OpportunitiesMeta,
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
 * Diseño post-cierre 3b:
 *   1) UNA query por external_id IN (...) + UNA por phone IN (...) → Map en memoria
 *   2) BULK upsert por batches de 500 para los inserts (onConflict ignora duplicados).
 *   3) Updates individuales en paralelo, pero salteando los no-op (patch que
 *      no cambia nada respecto al existing).
 *
 * Se procesa en DOS fases serializadas: contacts primero, después appointments.
 * El segundo locate ve los leads recién creados por el primero, evitando que
 * un appointment del mismo contacto cree un lead duplicado.
 *
 * Detección de tibio (cierre 3b): para cada contact del fetch incremental,
 * UNA llamada a `/conversations/search?contactId=...` para leer
 * `lastInboundWhatsappMessageDate`. Si cae en compra+cierre → tibio. Sin
 * paginar las 20k conversaciones del location. Cap defensivo de 2000 contacts
 * por corrida: si la corrida supera, se salta el lookup de tibio en esa
 * corrida (queda como follow-up natural en las siguientes incrementales).
 *
 * Reglas de clasificación (ver INTEGRATIONS_GHL.md):
 *   - tag 'cliente' → cerrado
 *   - conversación WA con `lastInboundWhatsappMessageDate` en compra+cierre → tibio
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
  opportunities: StageCounts;
}

export type GhlRunSummary =
  | {
      status: "success";
      counts: GhlCombinedCounts;
      meta: {
        contacts: ContactsMeta;
        appointments: AppointmentsMeta;
        opportunities: OpportunitiesMeta;
        /**
         * Cuántos contacts del fetch incremental se clasificaron como tibio
         * (señal `lastInboundWhatsappMessageDate ∈ compra+cierre`).
         */
        warm_signals_detected: number;
        /**
         * Cuántos contacts del fetch tenían al menos una conversación
         * inspeccionada (numerador esperado: <= contactItems.length).
         */
        warm_lookup_contacts_inspected: number;
        /**
         * True si la corrida superó el cap defensivo (`WARM_LOOKUP_CAP`) y se
         * saltó la detección de tibio. La próxima corrida incremental, más
         * chica, debería procesarlos.
         */
        warm_lookup_skipped_due_to_volume: boolean;
        /**
         * Errores durante el lookup individual (rate limit, timeout). El sync
         * continúa con los demás, marcando esos contacts sin señal warm.
         */
        warm_lookup_errors: number;
        mappings_applied: number;
      };
    }
  | {
      status: "token_invalid" | "rate_limited" | "error";
      stage:
        | "contacts"
        | "appointments"
        | "opportunities"
        | "warm_lookup"
        | "mappings";
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
const WARM_LOOKUP_CONCURRENCY = 10;
/**
 * Tope defensivo de contacts que disparan lookup de conversaciones por
 * contactId. Cada contact son ~200ms con concurrency 10 → 2000 contacts = ~40s.
 * Si la corrida trae más (típicamente la primera vez de un launch grande),
 * salteamos el lookup en esa corrida. Las siguientes incrementales (mucho
 * más chicas) los van a clasificar.
 */
const WARM_LOOKUP_CAP = 2000;

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

  // 2) Fetches GHL en paralelo. Contacts + appointments + opportunities.
  // El fetch masivo de conversations se eliminó en el cierre 3b (cuello de
  // botella de 60-90s sin clasificación confiable). La señal de tibio ahora
  // se hace contact-by-contact más abajo.
  const [contactsResult, apptResult, oppsResult] = await Promise.all([
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
    fetchGhlOpportunities({
      token: args.token,
      locationId: args.locationId,
      since: args.since,
      until: args.until,
      cutoffIso,
    }),
  ]);
  if (!contactsResult.ok) return propagateFailure(contactsResult, "contacts");
  if (!apptResult.ok) return propagateFailure(apptResult, "appointments");
  if (!oppsResult.ok) return propagateFailure(oppsResult, "opportunities");

  // 3) Lookup de tibio POR CONTACT (no masivo). Por cada contact del fetch
  // incremental, una request a `/conversations/search?contactId=...` para
  // leer `lastInboundWhatsappMessageDate`. Si cae en compra+cierre → tibio.
  //
  // Cap defensivo: si el fetch trae más de WARM_LOOKUP_CAP, salteamos el
  // lookup y todos quedan sin señal warm. La próxima corrida incremental,
  // mucho más chica, los va a clasificar.
  const warmStartMs = Date.parse(`${warmWindow.start}T00:00:00.000Z`);
  const warmEndMs = Date.parse(`${warmWindow.end}T23:59:59.999Z`);
  const inWindow = (iso: string | null): boolean => {
    if (!iso) return false;
    const ms = Date.parse(iso);
    return Number.isFinite(ms) && ms >= warmStartMs && ms <= warmEndMs;
  };

  const warmByContact = new Map<string, boolean>();
  let warmLookupSkippedDueToVolume = false;
  let warmLookupContactsInspected = 0;
  let warmLookupErrors = 0;

  if (contactsResult.rows.length > WARM_LOOKUP_CAP) {
    warmLookupSkippedDueToVolume = true;
  } else if (contactsResult.rows.length > 0) {
    const lookupResults = await parallelMap(
      contactsResult.rows,
      WARM_LOOKUP_CONCURRENCY,
      async (c) => {
        const res = await fetchGhlContactConversations(
          args.token,
          args.locationId,
          c.id,
        );
        if (!res.ok) return { contactId: c.id, warm: false, ok: false };
        const hasWarm = res.rows.some((conv) =>
          inWindow(conv.lastInboundWhatsappMessageDate),
        );
        return { contactId: c.id, warm: hasWarm, ok: true };
      },
    );
    for (const r of lookupResults) {
      warmLookupContactsInspected++;
      if (!r.ok) warmLookupErrors++;
      if (r.warm) warmByContact.set(r.contactId, true);
    }
  }

  // 4) Preparar items de contacts (normalización de phones).
  let warmSignalsDetected = 0;
  let mappingsApplied = 0;

  const contactItems: PreparedContactItem[] = contactsResult.rows.map((c) => {
    const phoneNormalized = normalize(c.rawPhone, country);
    const hasClientTag = c.tags.some((t) => t.toLowerCase() === "cliente");
    const hasRecentInboundActivity = warmByContact.get(c.id) === true;
    if (hasRecentInboundActivity) warmSignalsDetected++;

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

  // 8) Opportunities → launch_opportunities. Bulk upsert por (project_id,
  // external_id). A diferencia de leads, la "patch" siempre sobrescribe
  // todos los campos (la fuente autoritativa es GHL), entonces el upsert es
  // directo: no hay clasificación create/update/noop intermedia. Para
  // distinguir created vs updated en el conteo, hacemos un lookup previo
  // por external_id IN (...) — el volumen típico es <500 por corrida.
  const opportunitiesCounts = await syncOpportunities(args, oppsResult.rows);

  // 9) Orphan warm REMOVIDO en el cierre 3b: requería el fetch masivo de
  // conversations (60-90s, sin clasificación confiable). Trade-off: si GHL
  // no actualiza `dateUpdated` del contact cuando llega un mensaje, un lead
  // existente puede tardar una corrida más en subir a tibio (hasta que un
  // tag/edit del contact lo modifique y reentre al incremental). Aceptable.

  return {
    status: "success",
    counts: {
      contacts: contactsCounts,
      appointments: apptCounts,
      opportunities: opportunitiesCounts,
    },
    meta: {
      contacts: contactsResult.meta,
      appointments: apptResult.meta,
      opportunities: oppsResult.meta,
      warm_signals_detected: warmSignalsDetected,
      warm_lookup_contacts_inspected: warmLookupContactsInspected,
      warm_lookup_skipped_due_to_volume: warmLookupSkippedDueToVolume,
      warm_lookup_errors: warmLookupErrors,
      mappings_applied: mappingsApplied,
    },
  };
}

/**
 * Upsert masivo de opportunities a `launch_opportunities`. Idempotente por
 * (project_id, external_id). El `launch_id` del row se reescribe con el
 * launch actual — si la misma opp aparece en ventana de dos launches del
 * mismo proyecto, el último sync se la queda (mismo trade-off documentado
 * para leads, ver INTEGRATIONS_GHL.md §1).
 *
 * No hay detección de no-op: para opps el patch es "todo" (status, monetary,
 * pipeline, won_at), entonces siempre que GHL devuelva la opp se reescribe
 * la fila completa. Es barato: lookup por id (1 query), upsert (N/500 queries).
 */
async function syncOpportunities(
  args: RunGhlSyncArgs,
  rows: ReadonlyArray<GhlOpportunity>,
): Promise<StageCounts> {
  const counts: StageCounts = {
    fetched: rows.length,
    created: 0,
    updated: 0,
    skipped: 0,
  };
  if (rows.length === 0) return counts;

  // Lookup existentes por external_id IN (...). Volumen típico chico.
  const externalIds = rows.map((r) => r.id);
  const existingIds = new Set<string>();
  for (const idsChunk of chunk(uniqueStr(externalIds), 1000)) {
    const res = await loose(args.service)
      .from("launch_opportunities")
      .select("external_id")
      .eq("project_id", args.projectId)
      .in("external_id", idsChunk);
    if (res.error) {
      throw new Error(
        `GHL opportunities lookup: ${res.error.message ?? "unknown"}`,
      );
    }
    for (const r of (res.data ?? []) as Array<{ external_id: string }>) {
      existingIds.add(r.external_id);
    }
  }

  const nowIso = new Date().toISOString();
  const payloads: Record<string, unknown>[] = rows.map((opp) => ({
    project_id: args.projectId,
    launch_id: args.launchId,
    external_id: opp.id,
    contact_external_id: opp.contactId,
    assigned_to_ghl_user: opp.assignedTo,
    status: opp.status,
    monetary_value: opp.monetaryValue,
    source: opp.source,
    pipeline_id: opp.pipelineId,
    pipeline_stage_id: opp.pipelineStageId,
    won_at: opp.wonAt,
    created_at_ghl: opp.createdAt,
    updated_at_ghl: opp.updatedAt,
    raw: opp.raw,
    synced_at: nowIso,
  }));

  for (const batch of chunk(payloads, BULK_BATCH)) {
    const res = await loose(args.service)
      .from("launch_opportunities")
      .upsert(batch, { onConflict: "project_id,external_id" });
    if (res.error) {
      throw new Error(
        `GHL opportunities upsert: ${res.error.message ?? "unknown"}`,
      );
    }
  }

  for (const r of rows) {
    if (existingIds.has(r.id)) counts.updated++;
    else counts.created++;
  }
  return counts;
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
  stage:
    | "contacts"
    | "appointments"
    | "opportunities"
    | "warm_lookup"
    | "mappings",
): GhlRunSummary {
  return {
    status: failure.kind,
    stage,
    message: failure.message,
    detail: failure.detail,
    retryAfterSeconds: failure.retryAfterSeconds ?? null,
  };
}
