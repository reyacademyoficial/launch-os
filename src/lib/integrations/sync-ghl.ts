import "server-only";

import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

import {
  fetchGhlAppointments,
  fetchGhlContactConversations,
  fetchGhlContacts,
  fetchGhlConversations,
  fetchGhlOpportunities,
  type AppointmentsMeta,
  type ContactsMeta,
  type ConversationsMeta,
  type GhlAppointment,
  type GhlContact,
  type GhlConversation,
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
 * Se procesa en TRES fases serializadas: contacts → orphan WhatsApp →
 * appointments. Cada locate ve los leads creados por las fases anteriores,
 * evitando que un appointment o conversación duplique un lead que recién entró
 * por el pase anterior.
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
  /**
   * Leads creados/actualizados desde el pase "huérfano WA": contacts que NO
   * vinieron en el fetch de Contacts (porque su `dateUpdated` cayó fuera de
   * la ventana, ej. el contact se creó hace meses y nadie lo tocó desde
   * entonces) pero SÍ tienen actividad WhatsApp dentro de la ventana del
   * launch. Sin este pase, esos leads quedaban invisibles aunque hubiera
   * 1000 mensajes nuevos en el periodo.
   */
  orphan_whatsapp: StageCounts;
}

/** Endpoints de GHL que paginan; ver `meta.hit_max_pages` por cada uno. */
export type GhlPaginatedEndpoint = "contacts" | "conversations" | "opportunities";

interface GhlSuccessfulRunBody {
  counts: GhlCombinedCounts;
  meta: GhlRunMeta;
}

/**
 * `partial` se gatilla cuando algún endpoint paginado truncó por
 * `MAX_PAGES` — datos parciales escritos pero faltan páginas más viejas.
 * Variants separadas (no `status: "success" | "partial"`) para que TS
 * narrowee por discriminator literal en sync.ts.
 */
export type GhlRunSummary =
  | (GhlSuccessfulRunBody & {
      status: "success";
      hitMaxPages: readonly [];
    })
  | (GhlSuccessfulRunBody & {
      status: "partial";
      /** Endpoints que tocaron techo de paginación. Nunca vacío en partial. */
      hitMaxPages: ReadonlyArray<GhlPaginatedEndpoint>;
    })
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

interface GhlRunMeta {
  contacts: ContactsMeta;
  appointments: AppointmentsMeta;
  /**
   * Meta del pase "huérfano WA". Null si el fetch de conversaciones falló
   * (rate limit, token, etc.); en ese caso el run NO se aborta — el resto
   * del sync sigue — y el detalle queda en `conversations_error`.
   */
  conversations: ConversationsMeta | null;
  conversations_error: {
    kind: string;
    message: string;
    httpStatus: number | null;
    responseBody: unknown;
  } | null;
  /**
   * Null cuando el fetch de opportunities falló (ej. 422 por params no
   * soportados, 401 por scope faltante). En ese caso el run NO se aborta
   * — contacts + appointments + warm lookup siguen — y el detalle del
   * fallo queda en `opportunities_error`. KPIs de ventas se quedan con
   * los datos del fallback manual hasta que se vuelva a sincronizar.
   */
  opportunities: OpportunitiesMeta | null;
  opportunities_error: {
    kind: string;
    message: string;
    httpStatus: number | null;
    responseBody: unknown;
  } | null;
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
  /**
   * TEMP DIAG — muestras crudas del warm lookup para diagnosticar por qué
   * `warm_signals_detected` da 0. `errors` lleva hasta 5 fallos con su
   * httpStatus + responseBody; `successes` lleva hasta 5 contacts cuyo
   * lookup OK trajo al menos 1 conversation, con el objeto RAW completo
   * de cada conversation tal cual GHL la devolvió. Quitar una vez que
   * sepamos cómo viene el campo de "último mensaje entrante".
   */
  warm_samples: {
    errors: Array<{
      contactId: string;
      kind: string;
      httpStatus: number | null;
      responseBody: unknown;
    }>;
    successes: Array<{
      contactId: string;
      conversationCount: number;
      rawConversations: unknown[];
    }>;
  };
  mappings_applied: number;
  /**
   * GHL user ids encontrados como `assignedTo` en contacts o
   * conversations pero que NO tienen fila en `ghl_user_mappings`. Útil
   * para diagnosticar "configuré mapeos pero ningún lead viene con
   * setter": si esta lista trae IDs, faltan mapeos para esos usuarios.
   * Cap de 20 para evitar inflar la respuesta.
   */
  unmapped_ghl_user_ids: string[];
  /**
   * Leads cuyo `team_member_id` se rellenó a partir de `opp.assignedTo` +
   * mapping (cuando el contact no traía assignedTo pero la opp sí). Respeta
   * "manual gana": solo escribe donde estaba NULL.
   */
  opp_assignments_propagated: number;
}

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
  // Antes había un `const country = (args.defaultCountry || "AR") as CountryCode`
  // y se pasaba a todas las normalizaciones. Eso pisaba teléfonos no-AR.
  // Ahora la normalización va por-contacto: contacts usa `c.country` (lo que
  // GHL devuelve), y conversations + appointments parsean E.164-only sin
  // asumir región (no tienen country en el shape).
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

  // 2) Fetches GHL en paralelo: contacts + appointments + opportunities +
  // conversations (pase huérfano WA). Lanzar conversations ACÁ y NO después
  // del warm lookup es deliberado: el warm lookup es `WARM_LOOKUP_CAP` reqs
  // contact-by-contact (~84 con concurrency 10) que queman el bucket de rate
  // limit de GHL. Si dejábamos conversations para después se llevaba el 429.
  // Acá viajan en paralelo con el resto antes de cualquier ráfaga pesada.
  const [contactsResult, apptResult, oppsResult, conversationsResult] =
    await Promise.all([
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
      fetchGhlConversations({
        token: args.token,
        locationId: args.locationId,
        since: args.since,
        until: args.until,
        cutoffIso,
      }),
    ]);
  if (!contactsResult.ok) return propagateFailure(contactsResult, "contacts");
  if (!apptResult.ok) return propagateFailure(apptResult, "appointments");
  // Opportunities NO bloquea — si falla (422/401/etc), capturamos el detalle
  // y seguimos con contacts + appointments + warm lookup. La sub-meta de opps
  // queda en null y `opportunities_error` lleva el detalle del fallo.
  const opportunitiesRows: ReadonlyArray<GhlOpportunity> = oppsResult.ok
    ? oppsResult.rows
    : [];
  const opportunitiesMetaForSummary: OpportunitiesMeta | null = oppsResult.ok
    ? oppsResult.meta
    : null;
  const opportunitiesError = oppsResult.ok
    ? null
    : (() => {
        const detail = (oppsResult.detail ?? {}) as Record<string, unknown>;
        const httpStatusRaw = detail.httpStatus;
        return {
          kind: oppsResult.kind,
          message: oppsResult.message,
          httpStatus:
            typeof httpStatusRaw === "number" ? httpStatusRaw : null,
          responseBody: detail.responseBody ?? null,
        };
      })();

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

  /**
   * Detección de actividad WhatsApp inbound dentro del warmWindow. La señal
   * preferida es `lastInboundWhatsappMessageDate` — campo dedicado, no se
   * pisa cuando el operador responde después. PERO algunos locations de GHL
   * NO pueblan ese campo en absoluto (observado en runtime con mensajes
   * inbound reales que sí están en la UI). Fallback: derivar del último
   * mensaje genérico cuando es TYPE_WHATSAPP + dirección inbound + en
   * ventana. El fallback puede dar falsos negativos cuando el operador ya
   * respondió (lastMessageDirection vuelve outbound), pero NUNCA da falsos
   * positivos — sigue siendo "el lead nos escribió en compra+cierre".
   */
  const isWarmFromConversation = (conv: GhlConversation): boolean => {
    if (inWindow(conv.lastInboundWhatsappMessageDate)) return true;
    return (
      conv.lastMessageType === "TYPE_WHATSAPP" &&
      conv.lastMessageDirection === "inbound" &&
      inWindow(conv.lastMessageDate)
    );
  };

  const warmByContact = new Map<string, boolean>();
  let warmLookupSkippedDueToVolume = false;
  let warmLookupContactsInspected = 0;
  let warmLookupErrors = 0;
  // TEMP DIAG — samples crudos para entender por qué warm_signals_detected = 0.
  const warmErrorSamples: Array<{
    contactId: string;
    kind: string;
    httpStatus: number | null;
    responseBody: unknown;
  }> = [];
  const warmSuccessSamples: Array<{
    contactId: string;
    conversationCount: number;
    rawConversations: unknown[];
  }> = [];
  const WARM_SAMPLE_LIMIT = 5;

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
        if (!res.ok) {
          const detail = (res.detail ?? {}) as Record<string, unknown>;
          const httpStatusRaw = detail.httpStatus;
          return {
            contactId: c.id,
            ok: false as const,
            warm: false,
            failure: {
              kind: res.kind,
              httpStatus:
                typeof httpStatusRaw === "number" ? httpStatusRaw : null,
              responseBody: detail.responseBody ?? null,
            },
          };
        }
        const hasWarm = res.rows.some(isWarmFromConversation);
        return {
          contactId: c.id,
          ok: true as const,
          warm: hasWarm,
          rawConversations: res.rows.map((r) => r.raw),
        };
      },
    );
    for (const r of lookupResults) {
      warmLookupContactsInspected++;
      if (!r.ok) {
        warmLookupErrors++;
        if (warmErrorSamples.length < WARM_SAMPLE_LIMIT) {
          warmErrorSamples.push({
            contactId: r.contactId,
            kind: r.failure.kind,
            httpStatus: r.failure.httpStatus,
            responseBody: r.failure.responseBody,
          });
        }
        continue;
      }
      if (r.warm) warmByContact.set(r.contactId, true);
      // Solo nos interesa samplear contacts que SÍ tenían conversaciones
      // (los que no, no aportan info de shape).
      if (
        warmSuccessSamples.length < WARM_SAMPLE_LIMIT &&
        r.rawConversations.length > 0
      ) {
        warmSuccessSamples.push({
          contactId: r.contactId,
          conversationCount: r.rawConversations.length,
          rawConversations: r.rawConversations,
        });
      }
    }
  }

  // 4) Preparar items de contacts (normalización de phones).
  let warmSignalsDetected = 0;
  let mappingsApplied = 0;
  // Diag: GHL user ids vistos pero SIN fila en `ghl_user_mappings`. Si el
  // usuario configuró mapeos pero ninguno aparece en `mappings_applied`, este
  // set le muestra los IDs huérfanos que necesita mapear. Limitado a 20 para
  // no inflar la respuesta.
  const unmappedGhlUserIds = new Set<string>();
  const UNMAPPED_SAMPLE_LIMIT = 20;
  const recordUnmapped = (ghlUserId: string | null): void => {
    if (!ghlUserId) return;
    if (mappings.has(ghlUserId)) return;
    if (unmappedGhlUserIds.size >= UNMAPPED_SAMPLE_LIMIT) return;
    unmappedGhlUserIds.add(ghlUserId);
  };

  const contactItems: PreparedContactItem[] = contactsResult.rows.map((c) => {
    const phoneNormalized = normalize(c.rawPhone, asCountryCode(c.country));
    const hasClientTag = c.tags.some((t) => t.toLowerCase() === "cliente");
    const hasRecentInboundActivity = warmByContact.get(c.id) === true;
    if (hasRecentInboundActivity) warmSignalsDetected++;

    let teamMemberId: string | null | undefined = undefined;
    if (c.assignedTo) {
      const tm = mappings.get(c.assignedTo) ?? null;
      teamMemberId = tm;
      if (tm) mappingsApplied++;
      else recordUnmapped(c.assignedTo);
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
      teamMemberId: resolveTeamMemberAssignment(existing, item.teamMemberId),
    });
    return { action, existing, notes: buildContactNotes(item.contact) };
  });
  const contactsCounts = await applyBulk(args, contactActions);

  // 6b) Orphan WhatsApp pass.
  //
  // El fetch de Contacts (paso 2-6) filtra por `dateUpdated` del contact dentro
  // de la ventana del launch. Pero GHL NO bumpea `dateUpdated` con cada mensaje
  // de WhatsApp — solo cuando un workflow le toca un tag, edita campos, etc. Si
  // el operador no automatizó eso en GHL, un contact con 5 mensajes WA en
  // ventana puede quedar invisible para el sync. Este pase compensa:
  //
  //   - Procesamos `conversationsResult` (ya bajado en paralelo en el paso 2).
  //   - Dedup por `contactId`, quedándonos con la conversación más reciente.
  //   - Filtramos las que ya fueron procesadas por el pase de Contacts.
  //   - Para las "huérfanas", clasificamos con `eventKind: "contact"` igual que
  //     antes: tibio si `lastInboundWhatsappMessageDate ∈ warmWindow`, frio
  //     si no. `external_id = contactId` (mismo que el pase de Contacts) →
  //     cuando el operador toque el contact más adelante, el sync siguiente lo
  //     matchea por external_id y no duplica.
  //   - Skip silencioso de conversaciones sin teléfono normalizable: sin phone
  //     no podemos deduplicar contra leads de import/manual y el riesgo de
  //     duplicado supera al beneficio.
  //
  // Si el fetch falló (rate limit, token), seguimos con el resto del sync; el
  // detalle queda en `conversations_error` y el counts queda en cero.
  let orphanCounts: StageCounts = {
    fetched: 0,
    created: 0,
    updated: 0,
    skipped: 0,
  };
  let conversationsMetaForSummary: ConversationsMeta | null = null;
  let conversationsError: {
    kind: string;
    message: string;
    httpStatus: number | null;
    responseBody: unknown;
  } | null = null;

  if (!conversationsResult.ok) {
    const detail = (conversationsResult.detail ?? {}) as Record<string, unknown>;
    const httpStatusRaw = detail.httpStatus;
    conversationsError = {
      kind: conversationsResult.kind,
      message: conversationsResult.message,
      httpStatus: typeof httpStatusRaw === "number" ? httpStatusRaw : null,
      responseBody: detail.responseBody ?? null,
    };
  } else {
    conversationsMetaForSummary = conversationsResult.meta;
    const processedContactIds = new Set(
      contactItems.map((i) => i.contact.id),
    );
    // Dedup por contactId — un contact puede tener varias conversaciones; nos
    // quedamos con la del `lastMessageDate` más reciente para la señal warm.
    const byContactId = new Map<string, GhlConversation>();
    for (const conv of conversationsResult.rows) {
      if (!conv.contactId) continue;
      if (processedContactIds.has(conv.contactId)) continue;
      const prev = byContactId.get(conv.contactId);
      if (!prev) {
        byContactId.set(conv.contactId, conv);
        continue;
      }
      const a = conv.lastMessageDate ? Date.parse(conv.lastMessageDate) : 0;
      const b = prev.lastMessageDate ? Date.parse(prev.lastMessageDate) : 0;
      if (a > b) byContactId.set(conv.contactId, conv);
    }

    // Sin country por-conversación (GHL no lo emite a nivel conversation),
    // parseamos E.164-only. Para WhatsApp los teléfonos suelen venir ya en
    // E.164 con "+", así que en la práctica esto funciona bien. Los que no
    // se puedan parsear se filtran abajo (mejor descartar que poner prefijo
    // equivocado).
    const orphanItems = Array.from(byContactId.values())
      .map((conv) => ({
        conv,
        phoneNormalized: normalize(conv.rawPhone, undefined),
      }))
      .filter(
        (it): it is { conv: GhlConversation; phoneNormalized: string } =>
          it.phoneNormalized !== null,
      );

    orphanCounts.fetched = orphanItems.length;

    if (orphanItems.length > 0) {
      const orphanExternalIds = orphanItems.map((it) => it.conv.contactId!);
      const orphanPhones = orphanItems.map((it) => it.phoneNormalized);
      const orphanLookup = await buildLeadLookup({
        service: args.service,
        projectId: args.projectId,
        source: "ghl",
        externalIds: orphanExternalIds,
        phoneNormalizeds: orphanPhones,
      });

      const orphanActions = orphanItems.map<ClassifiedAction>((it) => {
        const externalId = it.conv.contactId!;
        const existing = lookup(
          orphanLookup,
          "ghl",
          externalId,
          it.phoneNormalized,
        );
        const hasRecentInboundActivity = isWarmFromConversation(it.conv);
        if (hasRecentInboundActivity) warmSignalsDetected++;

        // Mapping: si la conversación trae `assignedTo` (GHL user id) y hay
        // fila en ghl_user_mappings, resolvemos a team_member_id. Si no hay
        // fila, registramos el ID huérfano para diagnóstico. Si la conv no
        // trae assignedTo, dejamos `teamMemberId: undefined` para que
        // resolveMatchAction no toque el team_member_id existente.
        let teamMemberId: string | null | undefined = undefined;
        if (it.conv.assignedTo) {
          const tm = mappings.get(it.conv.assignedTo) ?? null;
          teamMemberId = tm;
          if (tm) mappingsApplied++;
          else recordUnmapped(it.conv.assignedTo);
        }

        const action = resolveMatchAction({
          eventKind: "contact",
          existing,
          externalId,
          contactName: it.conv.contactName,
          phoneNormalized: it.phoneNormalized,
          rawPhone: it.conv.rawPhone,
          email: null,
          hasClientTag: false,
          hasRecentInboundActivity,
          teamMemberId: resolveTeamMemberAssignment(existing, teamMemberId),
        });
        return { action, existing, notes: buildOrphanWaNotes(it.conv) };
      });
      orphanCounts = await applyBulk(args, orphanActions);
      // applyBulk pisa fetched con items.length — restauramos el original que
      // ya refleja la cantidad real de huérfanos detectados.
      orphanCounts.fetched = orphanItems.length;
    }
  }

  // 7) Preparar appointments y locate (incluyendo leads recién creados arriba).
  // Appointments tampoco traen `country` en el shape del calendar event.
  // Mismo trade-off que orphan WA: E.164-only sin asumir país.
  const apptItems: PreparedApptItem[] = apptResult.rows.map((e) => ({
    appt: e,
    phoneNormalized: normalize(e.rawPhone, undefined),
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
  // Si el fetch de opportunities falló, `opportunitiesRows` es [] y
  // `syncOpportunities` devuelve counts en cero — no toca DB.
  const opportunitiesCounts = await syncOpportunities(args, opportunitiesRows);

  // 9) Propagar `opp.assignedTo` → `lead.team_member_id`. En setups con
  // workflow ("cuando contacto escribe por WhatsApp asignar a usuario X"),
  // la asignación queda en la opportunity, NO en el contact. Sin esta pasada
  // los leads quedan sin setter aunque ya tenemos el dato en
  // `launch_opportunities.assigned_to_ghl_user`. Respetamos "manual gana":
  // solo escribimos donde `team_member_id IS NULL`.
  const oppAssignmentsPropagated = await propagateOpportunityAssignments({
    service: args.service,
    projectId: args.projectId,
    opportunities: opportunitiesRows,
    mappings,
  });

  // Bug 3 fix — `hit_max_pages` antes era una flag enterrada en meta y el run
  // cerraba como `success` aunque hubiéramos truncado. Ahora cualquier
  // endpoint paginado que tocó techo arrastra el run a `partial`, con la lista
  // de endpoints truncados para que el operador sepa qué falta.
  const hitMaxPages: GhlPaginatedEndpoint[] = [];
  if (contactsResult.meta.hit_max_pages) hitMaxPages.push("contacts");
  if (conversationsMetaForSummary?.hit_max_pages) hitMaxPages.push("conversations");
  if (opportunitiesMetaForSummary?.hit_max_pages) hitMaxPages.push("opportunities");

  const counts: GhlCombinedCounts = {
    contacts: contactsCounts,
    appointments: apptCounts,
    opportunities: opportunitiesCounts,
    orphan_whatsapp: orphanCounts,
  };
  const meta: GhlRunMeta = {
    contacts: contactsResult.meta,
    appointments: apptResult.meta,
    conversations: conversationsMetaForSummary,
    conversations_error: conversationsError,
    opportunities: opportunitiesMetaForSummary,
    opportunities_error: opportunitiesError,
    warm_signals_detected: warmSignalsDetected,
    warm_lookup_contacts_inspected: warmLookupContactsInspected,
    warm_lookup_skipped_due_to_volume: warmLookupSkippedDueToVolume,
    warm_lookup_errors: warmLookupErrors,
    warm_samples: {
      errors: warmErrorSamples,
      successes: warmSuccessSamples,
    },
    mappings_applied: mappingsApplied,
    unmapped_ghl_user_ids: Array.from(unmappedGhlUserIds),
    opp_assignments_propagated: oppAssignmentsPropagated,
  };

  if (hitMaxPages.length > 0) {
    return { status: "partial", hitMaxPages, counts, meta };
  }
  return { status: "success", hitMaxPages: [], counts, meta };
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

/**
 * Normaliza un teléfono crudo a E.164.
 *
 * Política post-Fase B Bug 1: NO asumimos país. La región default se pasa
 * por-contacto cuando GHL la trae (`c.country` ISO-2). Sin country:
 *
 *   - "+5491112345678" (E.164 completo)              → "+5491112345678"
 *   - "5491112345678" sin "+"                        → null (no parseable)
 *   - "11 1234-5678" local                           → null (no asumimos)
 *   - "+99999999999999" inválido                     → null
 *
 * Con country (ej. "AR"):
 *
 *   - "11 1234-5678" + AR                            → "+5491112345678"
 *   - "+5491112345678" + AR                          → "+5491112345678"
 *
 * Null significa "no pude normalizar sin meter un prefijo equivocado".
 * El caller mete el `rawPhone` en `leads.contact` y deja `phone_normalized`
 * en null — mejor un teléfono crudo que uno corrupto.
 */
export function normalize(
  raw: string | null,
  country: CountryCode | undefined,
): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const parsed = parsePhoneNumberFromString(trimmed, country);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.format("E.164");
}

/**
 * Cast del `country` string que viene del adapter (ya validado ISO-2 por
 * `extractCountryIso2`) al tipo `CountryCode` que pide libphonenumber-js.
 * Null/undefined del adapter → undefined para `normalize`.
 */
function asCountryCode(v: string | null | undefined): CountryCode | undefined {
  if (!v) return undefined;
  return v as CountryCode;
}

/**
 * Regla "manual gana, API rellena solo si vacío + mapeado, nunca null":
 *
 *   - Si el lead existente ya tiene `team_member_id` (asignación manual o de
 *     un sync previo confirmado) → devolvemos `undefined`, el patch del
 *     matcher no incluye `team_member_id` y la asignación NO se toca.
 *   - Si la API NO trae mapeo válido (assignedTo vacío o sin fila en
 *     `ghl_user_mappings`) → devolvemos `undefined` también, para nunca
 *     escribir un null que borre la asignación.
 *   - Solo cuando `existing` está vacío Y la API trae un mapeo no-null →
 *     devolvemos ese valor para que el matcher lo setee.
 *
 * Para leads nuevos (`existing === null`), aplica igual: si la API trae
 * mapeo lo seteamos en el create; si no, queda undefined y `createPayload`
 * lo resuelve a `null` (correcto — no hay manual que pisar).
 */
export function resolveTeamMemberAssignment(
  existing: ExistingLeadView | null,
  fromApi: string | null | undefined,
): string | undefined {
  if (existing && existing.team_member_id) return undefined;
  if (!fromApi) return undefined;
  return fromApi;
}

/**
 * Dedup de opportunities por `contactId`: si un contact tiene varias opps
 * con `assignedTo` poblado, nos quedamos con la más reciente por
 * `updatedAt`. Opps sin `contactId` o sin `assignedTo` se descartan.
 *
 * Pura — testeable sin DB.
 */
export function selectBestOppByContact(
  opps: ReadonlyArray<GhlOpportunity>,
): Map<string, GhlOpportunity> {
  const out = new Map<string, GhlOpportunity>();
  for (const opp of opps) {
    if (!opp.contactId || !opp.assignedTo) continue;
    const prev = out.get(opp.contactId);
    if (!prev) {
      out.set(opp.contactId, opp);
      continue;
    }
    const a = opp.updatedAt ? Date.parse(opp.updatedAt) : 0;
    const b = prev.updatedAt ? Date.parse(prev.updatedAt) : 0;
    if (Number.isFinite(a) && Number.isFinite(b) && a > b) {
      out.set(opp.contactId, opp);
    }
  }
  return out;
}

/**
 * Para cada opp con `assignedTo` mapeable, UPDATE el lead correspondiente
 * (matched por `external_id = contact_external_id`) seteando
 * `team_member_id` SOLO si está NULL. Manual gana: si el operador asignó
 * a mano, no se pisa.
 *
 * Por qué NO filtramos por `source='ghl'`: un lead puede haber entrado por
 * Meta primero (source='meta'), y un sync de GHL posterior lo matcheó por
 * teléfono → re-vinculó `external_id` al contact id de GHL pero `source`
 * quedó 'meta'. Esos leads igual son la misma persona; el filtro de source
 * los excluía y dejaba el rellenado en 0. La condición real es
 * "external_id == contact_external_id AND team_member_id IS NULL", sin
 * importar la source original.
 *
 * Agrupamos por team_member_id para hacer 1 query por setter (no 1 por
 * lead) — un UPDATE con `external_id IN (...)`. Chunkeamos a 500 ids por
 * query por límite de URL length de PostgREST.
 *
 * Errores no abortan el sync: si el UPDATE de un setter falla, los demás
 * siguen. La idea es maximizar el rellenado, no atomicidad.
 */
async function propagateOpportunityAssignments(args: {
  service: ServiceClient;
  projectId: string;
  opportunities: ReadonlyArray<GhlOpportunity>;
  mappings: Map<string, string>;
}): Promise<number> {
  if (args.opportunities.length === 0) return 0;
  const bestByContact = selectBestOppByContact(args.opportunities);
  if (bestByContact.size === 0) return 0;

  // Agrupar contactIds por team_member_id (= 1 query por setter, no por lead)
  const contactIdsByTeamMember = new Map<string, string[]>();
  for (const [contactId, opp] of bestByContact) {
    const tm = args.mappings.get(opp.assignedTo!);
    if (!tm) continue;
    const arr = contactIdsByTeamMember.get(tm);
    if (arr) arr.push(contactId);
    else contactIdsByTeamMember.set(tm, [contactId]);
  }
  if (contactIdsByTeamMember.size === 0) return 0;

  let updated = 0;
  for (const [teamMemberId, contactIds] of contactIdsByTeamMember) {
    for (const slice of chunk(contactIds, 500)) {
      const res = await loose(args.service)
        .from("leads")
        .update({ team_member_id: teamMemberId })
        .eq("project_id", args.projectId)
        .in("external_id", slice)
        .is("team_member_id", null)
        .select("id");
      if (res.error) continue;
      updated += ((res.data ?? []) as unknown[]).length;
    }
  }
  return updated;
}

function buildAppointmentNotes(e: GhlAppointment): string | null {
  if (!e.startTime) return null;
  return `GHL appointment ${e.id} — comienza ${e.startTime}`;
}

function buildContactNotes(c: GhlContact): string | null {
  if (!c.dateAdded) return null;
  return `GHL contact ${c.id} — creado ${c.dateAdded}`;
}

function buildOrphanWaNotes(conv: GhlConversation): string | null {
  // Trazabilidad mínima: dice de qué conversación nació + cuándo fue el último
  // mensaje. Útil al revisar un lead "raro" en el kanban.
  if (!conv.lastMessageDate) return `GHL WA orphan conv ${conv.id}`;
  return `GHL WA orphan conv ${conv.id} — last msg ${conv.lastMessageDate}`;
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
