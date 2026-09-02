import "server-only";

/**
 * Adapter GoHighLevel — API v2 (services.leadconnectorhq.com).
 *
 * Auth: Private Integration Token (PIT) por header `Authorization: Bearer`.
 * No vence (a diferencia del OAuth de v1 que rotaba). Mismo patrón que el
 * System User token de Meta.
 *
 * Endpoints usados:
 *   - GET /calendars/events?locationId=...&startTime=...&endTime=...
 *     → eventos del calendario en la ventana del launch (appointments).
 *   - POST /conversations/search
 *     → conversaciones por location, filtramos WhatsApp client-side.
 *
 * Versioning del API: GHL exige el header `Version: 2021-04-15` en TODAS las
 * llamadas v2. Si lo omitís devuelve 401 con un error críptico. La constante
 * está abajo y la chequeamos en el test para que no se nos pase.
 *
 * Lo que NO hace este módulo:
 *  - No toca la DB. Solo HTTP + mapeo defensivo de la respuesta.
 *  - No normaliza teléfonos. Devuelve los rawPhones como vinieron; el match
 *    en `sync-ghl.ts` los normaliza con `libphonenumber-js` antes de comparar.
 *  - No reintenta. 3c.
 */

export const GHL_API_BASE = "https://services.leadconnectorhq.com";
export const GHL_API_VERSION = "2021-04-15";

export type GhlSyncErrorKind = "token_invalid" | "rate_limited" | "error";

export interface GhlConversation {
  /** Id de la conversación. */
  id: string;
  /** Id del contact en GHL — sirve para fetchear tags. */
  contactId: string | null;
  rawPhone: string | null;
  contactName: string;
  /** Tipo de canal según GHL — usamos esto para filtrar WhatsApp. */
  type: string | null;
  /** ISO timestamp del último mensaje (útil para acotar al rango del launch). */
  lastMessageDate: string | null;
  /**
   * Tipo del último mensaje. GHL emite strings tipo "TYPE_WHATSAPP" para
   * el canal. ¡OJO! El "inbound/outbound" NO está acá — está en
   * `lastMessageDirection`. Acá lo guardamos sólo como referencia/telemetría.
   */
  lastMessageType: string | null;
  /**
   * Dirección del último mensaje: 'inbound' (el lead escribió) o 'outbound'
   * (el operador escribió). Esta es la señal autoritativa de "el lead
   * respondió", no `lastMessageType`.
   */
  lastMessageDirection: "inbound" | "outbound" | null;
  /**
   * ISO timestamp del último mensaje INBOUND de WhatsApp. Si tiene valor,
   * el lead escribió en algún momento — combinado con la ventana del launch
   * nos dice si fue dentro de compra+cierre. Más confiable que
   * `lastMessageDirection` porque no se pisa cuando el operador responde.
   */
  lastInboundWhatsappMessageDate: string | null;
  /** Cuántos mensajes inbound no leídos hay. Señal débil pero útil de "el lead respondió". */
  unreadCount: number | null;
  /**
   * GHL user id asignado a la conversación. Mismo formato que `GhlContact.assignedTo`
   * — se traduce vía `ghl_user_mappings` a `team_member_id` del lead. El pase huérfano
   * WA lo usa para no perder el setter cuando el contact viene por conversación y no
   * por el endpoint de Contacts.
   */
  assignedTo: string | null;
  raw: unknown;
}

export interface GhlContact {
  id: string;
  rawPhone: string | null;
  email: string | null;
  contactName: string;
  /** Tags asociados — usamos esto para detectar "cliente" → status='cerrado'. */
  tags: string[];
  /**
   * GHL user id del vendedor asignado al contact (campo `assignedTo` en la API).
   * Se traduce vía `ghl_user_mappings` a `team_member_id` del lead.
   */
  assignedTo: string | null;
  /** ISO timestamp de creación. */
  dateAdded: string | null;
  /** ISO timestamp de última modificación. */
  dateUpdated: string | null;
  /**
   * Código de país ISO-2 (`"AR"`, `"MX"`, …) tal cual lo emite GHL en el
   * contact. Null si el contact no lo tiene seteado o si GHL devolvió algo
   * que no es ISO-2 válido. Usado por el sync para normalizar el teléfono
   * a E.164 con la región correcta (en vez del literal "AR" que pisaba
   * contactos no-AR).
   */
  country: string | null;
  raw: unknown;
}

/** Ref pública de un GHL user — usado por la UI de mapeo de vendedores. */
export interface GhlUserRef {
  id: string;
  name: string;
}

export interface GhlFetchSuccess<T> {
  ok: true;
  rows: T[];
}

export interface GhlFetchFailure {
  ok: false;
  kind: GhlSyncErrorKind;
  message: string;
  detail: Record<string, unknown>;
  retryAfterSeconds?: number | null;
}

export type GhlFetchResult<T> = GhlFetchSuccess<T> | GhlFetchFailure;

export interface ConversationsMeta {
  /** Páginas pedidas a GHL (de 100 cada una). */
  pages_fetched: number;
  /** Total acumulado de conversaciones crudas a través de todas las páginas. */
  raw_total: number;
  /** Keys top-level del primer item, para verificar shape. */
  sample_conv_keys: string[];
  /** Valores distintos de `type` que vimos (es el canal del contacto). */
  observed_types: string[];
  /** Valores distintos de `lastMessageType`. */
  observed_last_message_types: string[];
  passed_type_filter: number;
  passed_window_filter: number;
  /** Si se cortó por fecha (cortocircuito incremental). */
  stopped_by_date_cutoff: boolean;
  /**
   * Si llegamos al MAX_PAGES sin que GHL devolviera "última página" (rows <
   * PAGE_SIZE) ni cortocircuito por fecha. Indica que probablemente nos
   * estemos perdiendo conversaciones más antiguas — diagnóstico de partial.
   */
  hit_max_pages: boolean;
  /** Valores distintos de `lastMessageDirection` que vimos — diagnóstico. */
  observed_directions: string[];
}

export interface ContactsMeta {
  pages_fetched: number;
  raw_total: number;
  sample_contact_keys: string[];
  /** Tags distintas observadas a lo largo de los contacts (para verificar que "cliente" aparezca). */
  observed_tags: string[];
  /** Cuántos contacts en ventana tenían tag "cliente". */
  with_client_tag: number;
  stopped_by_date_cutoff: boolean;
  /** Idem ConversationsMeta.hit_max_pages — diagnóstico de truncado. */
  hit_max_pages: boolean;
}

interface FetchArgs {
  token: string;
  locationId: string;
  since: string; // YYYY-MM-DD
  until: string; // YYYY-MM-DD
}

// ─── Users (para el modal de mapeo de vendedores) ─────────────────────────

// El sync ya no llama /calendars/ ni /calendars/events — la única razón por
// la que /users/ sobrevive es la UI de mapeo (server action listGhlUserMappings
// en sync-actions.ts). Todo lo relativo a appointments se removió en el
// refactor 2026-08-10; las opportunities volvieron en 0126 pero solo para
// contar leads por vendedor en una pipeline elegida.

/**
 * Lista users del location. La API devuelve `{ users: [...] }`. Si el PIT no
 * tiene scope `View Users`, falla con 401/403 → propagamos como token_invalid
 * y el caller corta.
 */
export async function fetchGhlUsers(
  token: string,
  locationId: string,
): Promise<GhlFetchResult<GhlUserRef>> {
  const url = `${GHL_API_BASE}/users/?locationId=${encodeURIComponent(locationId)}`;
  const result = await ghlFetch(url, token);
  if (!result.ok) return result;

  const items = extractArray(result.body, ["users"]);
  const rows: GhlUserRef[] = [];
  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    const u = item as Record<string, unknown>;
    const id = strOrNull(u.id);
    if (!id) continue;
    rows.push({ id, name: strOrNull(u.name) ?? id });
  }
  return { ok: true, rows };
}

// ─── Pipelines + conteo de leads por vendedor ─────────────────────────────

export interface GhlPipeline {
  id: string;
  name: string;
}

/**
 * Lista los pipelines del location. Endpoint: GET /opportunities/pipelines
 * Response shape: `{ pipelines: [{ id, name, stages, ... }] }`.
 */
export async function fetchGhlPipelines(
  token: string,
  locationId: string,
): Promise<GhlFetchResult<GhlPipeline>> {
  const url = `${GHL_API_BASE}/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`;
  const result = await ghlFetch(url, token);
  if (!result.ok) return result;

  const items = extractArray(result.body, ["pipelines"]);
  const rows: GhlPipeline[] = [];
  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    const p = item as Record<string, unknown>;
    const id = strOrNull(p.id);
    if (!id) continue;
    rows.push({ id, name: strOrNull(p.name) ?? id });
  }
  return { ok: true, rows };
}

export interface GhlPipelineLeadCount {
  ghlUserId: string;
  count: number;
}

const MAX_OPP_PAGES = 200; // 200 × 100 = 20 000 oportunidades máximo

export interface GhlPipelineFetchDiag {
  itemsFetched: number;
  nullAssignedTo: number;
  ghlTotal: number | null;
  bodyKeys: string[];
  firstOppKeys: string[];
}

type PipelineFetchResult =
  | GhlFetchFailure
  | { ok: true; rows: GhlPipelineLeadCount[]; diag: GhlPipelineFetchDiag };

/**
 * Trae el conteo de leads por vendedor en una pipeline.
 * `GET /opportunities/search?location_id=&pipeline_id=&limit=100`
 * Este endpoint usa snake_case (a diferencia del resto de v2 que usa camelCase).
 * GHL usa paginación por cursor: meta.startAfter + meta.startAfterId.
 */
export async function fetchGhlPipelineLeadCounts(
  token: string,
  locationId: string,
  pipelineId: string,
): Promise<PipelineFetchResult> {
  const countsByUser = new Map<string, number>();
  const diag: GhlPipelineFetchDiag = {
    itemsFetched: 0,
    nullAssignedTo: 0,
    ghlTotal: null,
    bodyKeys: [],
    firstOppKeys: [],
  };

  let startAfter: string | null = null;
  let startAfterId: string | null = null;
  let pageCount = 0;

  while (pageCount < MAX_OPP_PAGES) {
    pageCount++;
    const params = new URLSearchParams({ location_id: locationId, pipeline_id: pipelineId, limit: "100" });
    if (startAfter) params.set("startAfter", startAfter);
    if (startAfterId) params.set("startAfterId", startAfterId);

    const url = `${GHL_API_BASE}/opportunities/search?${params.toString()}`;
    const result = await ghlFetch(url, token);
    if (!result.ok) return result;

    const body = result.body as Record<string, unknown>;

    // Diagnóstico de la primera página
    if (pageCount === 1) {
      diag.bodyKeys = Object.keys(body);
      const meta = body?.meta as Record<string, unknown> | undefined;
      const total = meta?.total;
      if (typeof total === "number") diag.ghlTotal = total;
    }

    const items = extractArray(result.body, ["opportunities"]);
    if (items.length === 0) break;

    // Registrar keys del primer opportunity para diagnóstico
    if (diag.firstOppKeys.length === 0 && items[0] && typeof items[0] === "object") {
      diag.firstOppKeys = Object.keys(items[0] as Record<string, unknown>);
    }

    for (const item of items) {
      if (typeof item !== "object" || item === null) continue;
      const opp = item as Record<string, unknown>;
      diag.itemsFetched++;
      // En GHL las oportunidades tienen assignedTo null cuando el usuario se
      // asigna a nivel contacto. Fallback: opp.contact.assignedTo.
      const contact = opp.contact as Record<string, unknown> | null | undefined;
      const assignedTo = strOrNull(opp.assignedTo) ?? strOrNull(contact?.assignedTo);
      if (!assignedTo) { diag.nullAssignedTo++; continue; }
      countsByUser.set(assignedTo, (countsByUser.get(assignedTo) ?? 0) + 1);
    }

    if (items.length < 100) break;

    const meta = body?.meta as Record<string, unknown> | undefined;
    const nextSA = meta?.startAfter;
    const nextSAId = meta?.startAfterId;
    if (!nextSA && !nextSAId) break;
    startAfter = nextSA != null ? String(nextSA) : null;
    startAfterId = nextSAId != null ? String(nextSAId) : null;
  }

  // Oportunidades sin assignedTo van a un bucket "__unassigned__" con
  // team_member_id resuelto a null → caen en la fila "Sin asignar" del
  // ranking y suman al total del KPI.
  if (diag.nullAssignedTo > 0) {
    countsByUser.set("__unassigned__", diag.nullAssignedTo);
  }

  const rows: GhlPipelineLeadCount[] = Array.from(countsByUser, ([ghlUserId, count]) => ({
    ghlUserId,
    count,
  }));
  return { ok: true, rows, diag };
}

// ─── Conversations (WhatsApp) ──────────────────────────────────────────────

/**
 * Trae conversations de la location. GHL no tiene filtro server-side por
 * rango de fecha en este endpoint; filtramos por `lastMessageDate` en TS.
 * Para WA usamos `type` que GHL emite como "TYPE_WHATSAPP" o variantes;
 * matchamos por substring case-insensitive para tolerar cambios menores.
 */
export interface ConversationsFetchArgs extends FetchArgs {
  /**
   * Incremental: si está seteado, paramos de paginar cuando el item tiene
   * `lastMessageDate < cutoffIso` (lo que ya procesamos en el sync anterior).
   * Si no, recorremos toda la ventana `[since, until]`.
   */
  cutoffIso?: string | null;
}

const PAGE_SIZE = 100;
// Tope defensivo de páginas. Estaba en 50 (5k items por sync). Subido a 200
// (20k) — un location grande puede tener fácil 8-10k WhatsApps acumulados, y
// el cap silencioso era una de las hipótesis del partial data. Si se alcanza,
// `hit_max_pages = true` lo deja visible en error_detail para diagnóstico.
const MAX_PAGES = 200;
// Cap específico para /contacts/ (usado por fetchGhlContacts). Locations con
// >20k contacts activos en la ventana del launch necesitan más: verificado
// 2026-08-10 con location cuya ventana de 45 días tenía >20k contacts y el
// cap de 200 truncaba silenciosamente el count "leads nuevos GHL". Como el
// sync post-refactor ya no hace warm lookup ni fetch de opportunities/
// appointments, tenemos budget de rate limit para paginar más profundo.
const MAX_CONTACTS_PAGES = 500;

/**
 * Paginación de conversations con cortocircuito por fecha. GHL devuelve
 * ordenado por `lastMessageDate desc`, entonces:
 *   - Si encontramos un item < cutoff (la última sync), paramos: las
 *     siguientes páginas son aún más viejas.
 *   - Si encontramos un item < since (la ventana del launch), paramos.
 *   - Sin no, seguimos hasta MAX_PAGES.
 */
export async function fetchGhlConversations(
  args: ConversationsFetchArgs,
): Promise<
  | { ok: true; rows: GhlConversation[]; meta: ConversationsMeta }
  | GhlFetchFailure
> {
  const sinceMs = dateToEpochStart(args.since);
  const untilMs = dateToEpochEnd(args.until);
  const cutoffMs = args.cutoffIso ? Date.parse(args.cutoffIso) : null;
  // El cutoff efectivo es el MÁS RECIENTE entre el inicio de la ventana y
  // el último sync. Eso evita re-procesar lo que ya entró.
  const effectiveCutoff =
    cutoffMs !== null && Number.isFinite(cutoffMs)
      ? Math.max(sinceMs, cutoffMs)
      : sinceMs;

  const meta: ConversationsMeta = {
    pages_fetched: 0,
    raw_total: 0,
    sample_conv_keys: [],
    observed_types: [],
    observed_last_message_types: [],
    passed_type_filter: 0,
    passed_window_filter: 0,
    stopped_by_date_cutoff: false,
    hit_max_pages: false,
    observed_directions: [],
  };
  const typesSet = new Set<string>();
  const lastTypesSet = new Set<string>();
  const directionsSet = new Set<string>();
  const out: GhlConversation[] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const offset = page * PAGE_SIZE;
    const params = new URLSearchParams({
      locationId: args.locationId,
      limit: String(PAGE_SIZE),
      sort: "desc",
      sortBy: "last_message_date",
      offset: String(offset),
      // Filtramos WhatsApp en server-side. Antes el adapter pedía todo y
      // descartaba en TS — con 5k conversaciones (WA + IG + FB + email)
      // paginaba 50 veces para descartar 80% del volumen.
      lastMessageType: "TYPE_WHATSAPP",
    });
    const url = `${GHL_API_BASE}/conversations/search?${params.toString()}`;
    const result = await ghlFetch(url, args.token);
    if (!result.ok) return result;

    const rawItems = extractArray(result.body, ["conversations"]);
    meta.pages_fetched++;
    meta.raw_total += rawItems.length;

    if (meta.sample_conv_keys.length === 0 && rawItems[0]) {
      meta.sample_conv_keys = Object.keys(
        rawItems[0] as Record<string, unknown>,
      );
    }

    if (rawItems.length === 0) break; // GHL no tiene más

    let oldestThisPageMs = Number.POSITIVE_INFINITY;
    for (const item of rawItems) {
      if (typeof item !== "object" || item === null) continue;
      const conv = item as Record<string, unknown>;
      const id = strOrNull(conv.id);
      if (!id) continue;

      if (typeof conv.type === "string") typesSet.add(conv.type);
      if (typeof conv.lastMessageType === "string") {
        lastTypesSet.add(conv.lastMessageType);
      }
      if (typeof conv.lastMessageDirection === "string") {
        directionsSet.add(conv.lastMessageDirection);
      }

      const type = strOrNull(conv.type);
      const lastMessageType = strOrNull(conv.lastMessageType);
      const isWhats = isWhatsAppType(type) || isWhatsAppType(lastMessageType);

      const lastIso = parseGhlDate(conv.lastMessageDate);
      const lastMs = lastIso ? Date.parse(lastIso) : NaN;
      if (Number.isFinite(lastMs)) {
        oldestThisPageMs = Math.min(oldestThisPageMs, lastMs);
      }

      if (!isWhats) continue;
      meta.passed_type_filter++;

      if (Number.isFinite(lastMs) && (lastMs < sinceMs || lastMs > untilMs)) {
        continue;
      }
      meta.passed_window_filter++;

      out.push({
        id,
        contactId: strOrNull(conv.contactId),
        rawPhone: extractPhone(conv),
        contactName: extractContactName(conv),
        type: lastMessageType ?? type,
        lastMessageDate: lastIso,
        lastMessageType,
        lastMessageDirection: parseDirection(conv.lastMessageDirection),
        lastInboundWhatsappMessageDate: parseGhlDate(
          conv.lastInboundWhatsappMessageDate,
        ),
        unreadCount: numOrNull(conv.unreadCount),
        assignedTo: strOrNull(conv.assignedTo),
        raw: conv,
      });
    }

    // Cortocircuito: si el item más viejo de la página es anterior al
    // cutoff efectivo, no tiene sentido seguir paginando.
    if (
      Number.isFinite(oldestThisPageMs) &&
      oldestThisPageMs < effectiveCutoff
    ) {
      meta.stopped_by_date_cutoff = true;
      break;
    }
    if (rawItems.length < PAGE_SIZE) break; // última página parcial

    // Si en la próxima iteración vamos a salir del for por agotar MAX_PAGES,
    // marcamos el flag de truncado. Esto indica que probablemente GHL tenga
    // más conversaciones que no llegamos a leer — datos incompletos.
    if (page === MAX_PAGES - 1) {
      meta.hit_max_pages = true;
    }
  }

  meta.observed_types = Array.from(typesSet);
  meta.observed_last_message_types = Array.from(lastTypesSet);
  meta.observed_directions = Array.from(directionsSet);
  return { ok: true, rows: out, meta };
}

// ─── Inbound messages por día (Fase B) ──────────────────────────────────────

/**
 * Resultado por día del adapter de mensajes. `inbound` cuenta solo mensajes
 * que pasan el matcher familia SMS-or-WhatsApp. `observedTypes` agrupa TODOS
 * los messageType vistos ese día (incluso descartados) — sirve para auditar
 * por qué la cuenta no incluye Instagram/Email/Activity.
 */
export interface MessagesDayBucket {
  inbound: number;
  observedTypes: Record<string, number>;
}

export interface MessagesByDayMeta {
  /** Conversaciones que devolvió /conversations/search (total acumulado). */
  conversations_fetched_total: number;
  /** Conversaciones que caen en [since, until] por su lastMessageDate. */
  conversations_in_window: number;
  /** True si pegamos el cap de conversaciones (`conversationsCap`). */
  conversations_hit_cap: boolean;
  /** True si paginamos conversations hasta MAX_PAGES sin terminar. */
  conversations_hit_max_pages: boolean;
  /** Conversaciones cuyo pase de mensajes llegó al MAX_MSG_PAGES sin terminar. */
  conversations_messages_hit_max: number;
  /** Distribución observada de messageType (TODOS, incluso descartados). */
  observed_message_types: Record<string, number>;
  /** Cuántos mensajes pasaron el matcher familia (SMS-or-WhatsApp inbound). */
  matched_inbound: number;
  /** Conversaciones cuyo /messages devolvió 0. */
  conversations_empty_messages: number;
  /** Errores no fatales por conversación (red, 5xx, etc. — el sync sigue). */
  per_conv_errors: number;
  /** Rate-limits recibidos al pedir mensajes (429). */
  per_conv_rate_limited: number;
}

export interface MessagesByDayResult {
  ok: true;
  /** Mapa fecha YYYY-MM-DD → bucket. Ordenado por fecha en la salida del orchestrator. */
  byDate: Record<string, MessagesDayBucket>;
  meta: MessagesByDayMeta;
}

export type MessagesByDayFetchResult = MessagesByDayResult | GhlFetchFailure;

export interface MessagesByDayArgs extends FetchArgs {
  /** Cap defensivo de conversaciones que mensajeamos. Default 500. */
  conversationsCap?: number;
  /**
   * Tipos de `lastMessageType` a filtrar server-side, multi-pass. Hacemos una
   * llamada a /conversations/search por cada tipo para que GHL nos devuelva
   * SOLO conversaciones de ese canal — sin filtro, locations grandes (>20k
   * convs nuevas en pocos días) no caben en MAX_PAGES y no llegamos a la
   * ventana del launch (verificado 2026-06-23: 20k convs en 8 días).
   *
   * Default = familia SMS/WhatsApp verificada en data real:
   *   ['TYPE_WHATSAPP', 'TYPE_SMS', 'TYPE_CUSTOM_SMS']
   *
   * Trade-off: solo mira el LAST messageType de la conv. Conversaciones donde
   * hubo SMS/WhatsApp pero el último mensaje cambió a otro canal se pierden.
   * Pérdida estimada <5% — el brief ya advierte que totales no coinciden
   * exactamente entre series.
   */
  lastMessageTypeFilters?: string[];
}

const MESSAGES_PER_PAGE = 100;
const MAX_MSG_PAGES_PER_CONV = 20; // hasta 2000 mensajes por conv — sobra
const PER_CONV_SLEEP_MS = 120; // pacing entre conversaciones (GHL rate-limita)

/**
 * Default de tipos a buscar server-side. Verificado contra location real
 * (WDYpjQTiKpK6eUD1aFYZ, probe 2026-06-23):
 *   - TYPE_WHATSAPP: WhatsApp Business API estándar
 *   - TYPE_SMS: SMS nativo
 *   - TYPE_CUSTOM_SMS: WhatsApp-App-level (lo que el operador usaba)
 *
 * Si una cuenta nueva expone otros TYPE_*_SMS / TYPE_*_WHATSAPP, agregar acá.
 */
const DEFAULT_LAST_MESSAGE_TYPE_FILTERS: ReadonlyArray<string> = [
  "TYPE_WHATSAPP",
  "TYPE_SMS",
  "TYPE_CUSTOM_SMS",
];

/**
 * Cuenta mensajes INBOUND WhatsApp/SMS por día para un launch.
 *
 * Diferencia con el sync vigente: NO filtra conversations por
 * `lastMessageType=TYPE_WHATSAPP` — ese filtro dropea el WhatsApp-App-level
 * que GHL emite como `TYPE_CUSTOM_SMS` (verificado 2026-06-23 con probe contra
 * data real). Acá traemos todas las conversations con last_message_date en
 * `[since, until]` y filtramos a nivel mensaje individual con un matcher
 * familia: `messageType` contiene "SMS" o "WHATSAPP" (case-insensitive).
 *
 * Endpoint key: GET /conversations/{id}/messages devuelve
 *   { messages: { lastMessageId, nextPage, messages: [...] }, traceId }
 * El array está ANIDADO un nivel — no en `body.messages` directo. `extractNestedMessages`
 * abajo maneja los dos shapes por defensa.
 *
 * Pacing: dormimos PER_CONV_SLEEP_MS entre conversaciones porque /messages
 * rate-limita en bursts. Si igual cae 429, hacemos UN retry con backoff.
 */
export async function fetchGhlInboundMessagesByDay(
  args: MessagesByDayArgs,
): Promise<MessagesByDayFetchResult> {
  const sinceMs = dateToEpochStart(args.since);
  const untilMs = dateToEpochEnd(args.until);
  const cap = Math.max(1, args.conversationsCap ?? 500);
  const typeFilters =
    args.lastMessageTypeFilters && args.lastMessageTypeFilters.length > 0
      ? args.lastMessageTypeFilters
      : DEFAULT_LAST_MESSAGE_TYPE_FILTERS;

  const meta: MessagesByDayMeta = {
    conversations_fetched_total: 0,
    conversations_in_window: 0,
    conversations_hit_cap: false,
    conversations_hit_max_pages: false,
    conversations_messages_hit_max: 0,
    observed_message_types: {},
    matched_inbound: 0,
    conversations_empty_messages: 0,
    per_conv_errors: 0,
    per_conv_rate_limited: 0,
  };

  const byDate = new Map<string, MessagesDayBucket>();
  const conversationsToProcess: string[] = [];
  const seenConvIds = new Set<string>(); // dedupe entre passes

  // ── Paso 1: paginar conversations con filtro server-side de lastMessageType,
  //    multi-pass — uno por cada tipo de la familia. Sin este filtro, locations
  //    grandes (>20k convs nuevas) no caben en MAX_PAGES (verificado en prod).
  for (const lastMessageType of typeFilters) {
    for (let page = 0; page < MAX_PAGES; page++) {
      const offset = page * PAGE_SIZE;
      const params = new URLSearchParams({
        locationId: args.locationId,
        limit: String(PAGE_SIZE),
        sort: "desc",
        sortBy: "last_message_date",
        offset: String(offset),
        lastMessageType,
      });
      const url = `${GHL_API_BASE}/conversations/search?${params.toString()}`;
      const result = await ghlFetch(url, args.token);
      if (!result.ok) return result;

      const rawItems = extractArray(result.body, ["conversations"]);
      meta.conversations_fetched_total += rawItems.length;
      if (rawItems.length === 0) break;

      let oldestThisPageMs = Number.POSITIVE_INFINITY;
      let capHitThisPass = false;
      for (const item of rawItems) {
        if (typeof item !== "object" || item === null) continue;
        const conv = item as Record<string, unknown>;
        const id = strOrNull(conv.id);
        if (!id) continue;

        // GHL devuelve `lastMessageDate` como epoch ms (verificado con probe).
        const lastMs =
          typeof conv.lastMessageDate === "number" &&
          Number.isFinite(conv.lastMessageDate)
            ? conv.lastMessageDate
            : null;
        if (lastMs === null) continue;

        if (lastMs < oldestThisPageMs) oldestThisPageMs = lastMs;
        if (lastMs < sinceMs || lastMs > untilMs) continue;

        meta.conversations_in_window++;
        if (seenConvIds.has(id)) continue; // ya la trajimos en otro pass
        if (conversationsToProcess.length < cap) {
          seenConvIds.add(id);
          conversationsToProcess.push(id);
        } else {
          meta.conversations_hit_cap = true;
          capHitThisPass = true;
        }
      }

      // Cortocircuito por fecha — todo lo siguiente es más viejo.
      if (Number.isFinite(oldestThisPageMs) && oldestThisPageMs < sinceMs) break;
      if (rawItems.length < PAGE_SIZE) break;
      if (page === MAX_PAGES - 1) meta.conversations_hit_max_pages = true;
      // Si pegamos el cap en esta pasada, no tiene sentido seguir paginando
      // el mismo tipo — pero seguimos con los próximos tipos.
      if (capHitThisPass) break;
    }
    // Cap global — si ya llenamos, los próximos tipos no aportan.
    if (conversationsToProcess.length >= cap) {
      meta.conversations_hit_cap = true;
      break;
    }
  }

  // ── Paso 2: por cada conversación, paginar /messages, contar por día.
  for (let i = 0; i < conversationsToProcess.length; i++) {
    if (i > 0) await sleep(PER_CONV_SLEEP_MS);
    const convId = conversationsToProcess[i]!;
    const convResult = await accumulateConversationMessages({
      token: args.token,
      conversationId: convId,
      sinceMs,
      untilMs,
      byDate,
      meta,
    });
    // Errores no fatales (red transient, 5xx) ya contaron en per_conv_errors.
    // Si el backend fue auth_invalid o rate_limited persistente, abortamos.
    if (convResult.kind === "abort") {
      return convResult.failure;
    }
  }

  // ── Materializar el map a Record (más fácil de serializar/comparar).
  const out: Record<string, MessagesDayBucket> = {};
  for (const [date, bucket] of byDate.entries()) {
    out[date] = bucket;
  }
  return { ok: true, byDate: out, meta };
}

interface ConvAccumArgs {
  token: string;
  conversationId: string;
  sinceMs: number;
  untilMs: number;
  byDate: Map<string, MessagesDayBucket>;
  meta: MessagesByDayMeta;
}

type ConvAccumResult =
  | { kind: "done" }
  | { kind: "abort"; failure: GhlFetchFailure };

/**
 * Pagina los mensajes de UNA conversación, filtra los inbound que pasan el
 * matcher familia, bucketea por día y muta `byDate`.
 *
 * Rate limit: GHL responde 429 a veces. UN retry con backoff. Si vuelve a
 * caer, sumamos `per_conv_rate_limited` y seguimos con la próxima conv (no
 * abortamos el sync entero por una conv rate-limited).
 *
 * Cortocircuito por fecha: GHL devuelve mensajes desc por dateAdded. Cuando
 * vemos un mensaje con dateAdded < sinceMs paramos — los siguientes son más
 * viejos.
 */
async function accumulateConversationMessages(
  args: ConvAccumArgs,
): Promise<ConvAccumResult> {
  let lastId: string | null = null;
  for (let page = 0; page < MAX_MSG_PAGES_PER_CONV; page++) {
    const params = new URLSearchParams({ limit: String(MESSAGES_PER_PAGE) });
    if (lastId) params.set("lastMessageId", lastId);
    const url = `${GHL_API_BASE}/conversations/${encodeURIComponent(
      args.conversationId,
    )}/messages?${params.toString()}`;

    const result = await ghlFetch(url, args.token);

    if (!result.ok) {
      // El backoff por 429 ya lo hace ghlFetch. Si igual llegó acá, la
      // location está saturada: contamos la conv y seguimos con la próxima.
      if (result.kind === "rate_limited") {
        args.meta.per_conv_rate_limited++;
        return { kind: "done" };
      }
      // token_invalid → abort todo. Otros errores → contamos y seguimos.
      if (result.kind === "token_invalid") {
        return { kind: "abort", failure: result };
      }
      args.meta.per_conv_errors++;
      return { kind: "done" };
    }

    // Envelope anidado: body.messages = { lastMessageId, nextPage, messages: [...] }
    const messages = extractNestedMessages(result.body);
    if (messages.length === 0) {
      if (page === 0) args.meta.conversations_empty_messages++;
      break;
    }

    let oldestMs = Number.POSITIVE_INFINITY;
    let lastMessageIdInPage: string | null = null;

    for (const m of messages) {
      if (typeof m !== "object" || m === null) continue;
      const msg = m as Record<string, unknown>;

      const id = strOrNull(msg.id);
      if (id) lastMessageIdInPage = id;

      const messageType = strOrNull(msg.messageType);
      if (messageType) {
        args.meta.observed_message_types[messageType] =
          (args.meta.observed_message_types[messageType] ?? 0) + 1;
      }

      const direction = parseDirection(msg.direction);
      const dateIso = parseGhlDate(msg.dateAdded);
      const ms = dateIso ? Date.parse(dateIso) : NaN;
      if (Number.isFinite(ms)) oldestMs = Math.min(oldestMs, ms);

      // Solo inbound + en ventana + matcher familia.
      if (direction !== "inbound") continue;
      if (!Number.isFinite(ms)) continue;
      if (ms < args.sinceMs || ms > args.untilMs) continue;
      if (!isWhatsAppOrSmsMessageType(messageType)) continue;

      const date = dateIso ? dateIso.slice(0, 10) : null;
      if (!date) continue;

      args.meta.matched_inbound++;
      const bucket = args.byDate.get(date);
      if (bucket) {
        bucket.inbound++;
        bucket.observedTypes[messageType ?? "<unknown>"] =
          (bucket.observedTypes[messageType ?? "<unknown>"] ?? 0) + 1;
      } else {
        args.byDate.set(date, {
          inbound: 1,
          observedTypes: { [messageType ?? "<unknown>"]: 1 },
        });
      }
    }

    // Cortocircuito por fecha — todos los próximos mensajes son más viejos.
    if (Number.isFinite(oldestMs) && oldestMs < args.sinceMs) break;
    if (messages.length < MESSAGES_PER_PAGE) break;
    if (!lastMessageIdInPage) break;
    lastId = lastMessageIdInPage;

    if (page === MAX_MSG_PAGES_PER_CONV - 1) {
      args.meta.conversations_messages_hit_max++;
    }
  }
  return { kind: "done" };
}

/**
 * Extrae el array de mensajes del response de /conversations/{id}/messages.
 * GHL anida: `{ messages: { messages: [...] } }` — verificado con probe
 * 2026-06-23. Acepta también el shape "plano" por defensa.
 *
 * Exportada para tests.
 */
export function extractNestedMessages(body: unknown): unknown[] {
  if (body === null || typeof body !== "object") return [];
  const rec = body as Record<string, unknown>;
  // Plano: body.messages = [...]
  if (Array.isArray(rec.messages)) return rec.messages as unknown[];
  // Envelope: body.messages = { messages: [...] }
  if (rec.messages !== null && typeof rec.messages === "object") {
    const inner = rec.messages as Record<string, unknown>;
    if (Array.isArray(inner.messages)) return inner.messages as unknown[];
  }
  return [];
}

/**
 * Matcher familia WhatsApp/SMS — captura TYPE_WHATSAPP, TYPE_SMS,
 * TYPE_CUSTOM_SMS, TYPE_BUSINESS_SMS, etc. Excluye TYPE_INSTAGRAM,
 * TYPE_EMAIL, TYPE_ACTIVITY_*.
 *
 * Exportada para tests.
 */
export function isWhatsAppOrSmsMessageType(messageType: string | null): boolean {
  if (!messageType) return false;
  const upper = messageType.toUpperCase();
  return upper.includes("SMS") || upper.includes("WHATSAPP");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Contacts (formulario y CRM general) ────────────────────────────────────

export interface ContactsFetchArgs extends FetchArgs {
  cutoffIso?: string | null;
}

/**
 * Lista contacts del location ordenados por `dateUpdated desc`. Pagina con
 * `startAfterId`/`startAfter` (los dos cursores que usa GHL). Cortocircuito
 * por `dateUpdated < cutoffEfectivo`.
 *
 * Mismo enfoque que conversations: el sync incremental procesa contacts
 * nuevos Y modificados desde la última corrida (ej. un contact viejo al que
 * le agregaron el tag "cliente").
 */
export async function fetchGhlContacts(
  args: ContactsFetchArgs,
): Promise<{ ok: true; rows: GhlContact[]; meta: ContactsMeta } | GhlFetchFailure> {
  const sinceMs = dateToEpochStart(args.since);
  const untilMs = dateToEpochEnd(args.until);
  const cutoffMs = args.cutoffIso ? Date.parse(args.cutoffIso) : null;
  const effectiveCutoff =
    cutoffMs !== null && Number.isFinite(cutoffMs)
      ? Math.max(sinceMs, cutoffMs)
      : sinceMs;

  const meta: ContactsMeta = {
    pages_fetched: 0,
    raw_total: 0,
    sample_contact_keys: [],
    observed_tags: [],
    with_client_tag: 0,
    stopped_by_date_cutoff: false,
    hit_max_pages: false,
  };
  const tagsSet = new Set<string>();
  const out: GhlContact[] = [];

  let startAfter: number | null = null;
  let startAfterId: string | null = null;

  for (let page = 0; page < MAX_CONTACTS_PAGES; page++) {
    const params = new URLSearchParams({
      locationId: args.locationId,
      limit: String(PAGE_SIZE),
    });
    if (startAfter !== null) params.set("startAfter", String(startAfter));
    if (startAfterId) params.set("startAfterId", startAfterId);
    const url = `${GHL_API_BASE}/contacts/?${params.toString()}`;
    const result = await ghlFetch(url, args.token);
    if (!result.ok) return result;

    const rawItems = extractArray(result.body, ["contacts"]);
    meta.pages_fetched++;
    meta.raw_total += rawItems.length;

    if (meta.sample_contact_keys.length === 0 && rawItems[0]) {
      meta.sample_contact_keys = Object.keys(
        rawItems[0] as Record<string, unknown>,
      );
    }

    if (rawItems.length === 0) break;

    let oldestThisPageMs = Number.POSITIVE_INFINITY;
    let lastIdSeen: string | null = null;
    let lastUpdatedMs: number | null = null;

    for (const item of rawItems) {
      if (typeof item !== "object" || item === null) continue;
      const c = item as Record<string, unknown>;
      const id = strOrNull(c.id);
      if (!id) continue;
      lastIdSeen = id;

      const tags = Array.isArray(c.tags)
        ? (c.tags as unknown[]).filter((t): t is string => typeof t === "string")
        : [];
      for (const t of tags) tagsSet.add(t.toLowerCase());

      const dateUpdated = strOrNull(c.dateUpdated);
      const dateAdded = strOrNull(c.dateAdded);
      const updatedMs = dateUpdated ? Date.parse(dateUpdated) : NaN;
      if (Number.isFinite(updatedMs)) {
        oldestThisPageMs = Math.min(oldestThisPageMs, updatedMs);
        lastUpdatedMs = updatedMs;
      }

      // Solo incluimos si dateUpdated cae dentro de [sinceMs, untilMs].
      if (
        Number.isFinite(updatedMs) &&
        (updatedMs < sinceMs || updatedMs > untilMs)
      ) {
        continue;
      }

      const hasClient = tags.some((t) => t.toLowerCase() === "cliente");
      if (hasClient) meta.with_client_tag++;

      out.push({
        id,
        rawPhone: extractPhone(c),
        email: strOrNull(c.email),
        contactName: extractContactName(c),
        tags,
        assignedTo: strOrNull(c.assignedTo),
        dateAdded,
        dateUpdated,
        country: extractCountryIso2(c),
        raw: c,
      });
    }

    if (
      Number.isFinite(oldestThisPageMs) &&
      oldestThisPageMs < effectiveCutoff
    ) {
      meta.stopped_by_date_cutoff = true;
      break;
    }
    if (rawItems.length < PAGE_SIZE) break;

    // Cursor para próxima página.
    startAfter = lastUpdatedMs;
    startAfterId = lastIdSeen;
    if (startAfter === null || startAfterId === null) break;

    // Última iteración antes de agotar MAX_CONTACTS_PAGES → señalamos
    // truncado para que el diagnóstico del run lo refleje.
    if (page === MAX_CONTACTS_PAGES - 1) {
      meta.hit_max_pages = true;
    }
  }

  meta.observed_tags = Array.from(tagsSet);
  return { ok: true, rows: out, meta };
}

// ─── Contacts count por día (POST /contacts/search) ───────────────────────

export interface DailyLeadCount {
  date: string; // YYYY-MM-DD
  total: number;
}

export interface DailyLeadCountsMeta {
  /** Cantidad de días de la ventana consultados (1 request por día). */
  days_queried: number;
  /** True si algún día devolvió un error tolerable (contamos como 0 y seguimos). */
  had_per_day_errors: boolean;
  /** Cuántos días fallaron (no propagados). Diagnóstico. */
  per_day_errors: number;
  /** Keys top-level de la primera respuesta OK — para verificar shape. */
  sample_response_keys: string[];
}

export interface DailyLeadCountsFetchArgs {
  token: string;
  locationId: string;
  since: string; // YYYY-MM-DD
  until: string; // YYYY-MM-DD
}

/**
 * Trae SOLO el count de contacts nuevos por día usando `POST /contacts/search`
 * con `pageLimit: 1` y filtro `dateAdded` acotado a UN día. GHL devuelve el
 * `total` en el header de la respuesta — no paginamos.
 *
 * Por qué este endpoint y no `/contacts/` paginado:
 *   - `/contacts/` no filtra por dateAdded server-side. Había que traerse
 *     TODOS los contacts (payload completo: nombre, phone, email, tags,
 *     custom fields, etc.) y filtrar client-side. Para locations grandes
 *     esto se comía la cuota de rate limit y tocaba el cap de páginas.
 *   - `/contacts/search` filtra server-side y con pageLimit=1 la respuesta
 *     es un objeto chico con `contacts: [1 item]` + `total: N`.
 *
 * Costo: 1 request por día del launch (típicamente 30-45 requests). Bajo
 * comparado con los 200-500 pages del enfoque anterior.
 *
 * Sensibilidad a shape: GHL a veces devuelve `total` en camelCase, snake_case
 * o dentro de un envelope `meta`. Probamos todas las variantes. Si ninguna
 * matchea → contamos como 0 para ese día (no aborta el sync).
 */
export async function fetchGhlContactCountsByDay(
  args: DailyLeadCountsFetchArgs,
): Promise<
  | { ok: true; rows: DailyLeadCount[]; meta: DailyLeadCountsMeta }
  | GhlFetchFailure
> {
  const days = enumerateDays(args.since, args.until);
  const meta: DailyLeadCountsMeta = {
    days_queried: 0,
    had_per_day_errors: false,
    per_day_errors: 0,
    sample_response_keys: [],
  };
  const rows: DailyLeadCount[] = [];

  for (const date of days) {
    const startIso = `${date}T00:00:00.000Z`;
    const endIso = `${date}T23:59:59.999Z`;
    const body = JSON.stringify({
      locationId: args.locationId,
      pageLimit: 1,
      filters: [
        {
          field: "dateAdded",
          operator: "range",
          value: { gte: startIso, lte: endIso },
        },
      ],
    });
    const url = `${GHL_API_BASE}/contacts/search`;
    const result = await ghlFetch(url, args.token, { method: "POST", body });
    meta.days_queried++;

    // Auth y rate limit propagan (no seguimos si el token está roto o nos
    // están rate-limitando: los próximos días fallarían igual).
    if (!result.ok) {
      if (result.kind === "token_invalid" || result.kind === "rate_limited") {
        return result;
      }
      meta.had_per_day_errors = true;
      meta.per_day_errors++;
      rows.push({ date, total: 0 });
      continue;
    }

    if (
      meta.sample_response_keys.length === 0 &&
      typeof result.body === "object" &&
      result.body !== null
    ) {
      meta.sample_response_keys = Object.keys(
        result.body as Record<string, unknown>,
      );
    }

    const total = extractTotal(result.body);
    rows.push({ date, total: total ?? 0 });
  }

  return { ok: true, rows, meta };
}

/**
 * Intenta extraer el `total` de la respuesta de `/contacts/search` probando
 * las variantes documentadas por GHL. Si ninguna matchea, devuelve null y
 * el caller lo trata como 0.
 */
function extractTotal(body: unknown): number | null {
  if (typeof body !== "object" || body === null) return null;
  const obj = body as Record<string, unknown>;

  // Variante 1: `total` directo en el body.
  if (typeof obj.total === "number" && Number.isFinite(obj.total)) {
    return obj.total;
  }
  // Variante 2: `totalCount` (algunos endpoints de GHL usan este alias).
  if (
    typeof obj.totalCount === "number" &&
    Number.isFinite(obj.totalCount)
  ) {
    return obj.totalCount;
  }
  // Variante 3: dentro de `meta.total`.
  if (obj.meta && typeof obj.meta === "object") {
    const m = obj.meta as Record<string, unknown>;
    if (typeof m.total === "number" && Number.isFinite(m.total)) {
      return m.total;
    }
  }
  // Fallback: contar el array `contacts` (pero con pageLimit=1 esto siempre
  // sería 0 o 1, así que no sirve como conteo real — devolvemos null para
  // que el caller sepa que no pudo leer el total).
  return null;
}

/**
 * Genera la lista de fechas YYYY-MM-DD entre `since` y `until` inclusive.
 * Iteramos en UTC para no depender del timezone del server.
 */
function enumerateDays(since: string, until: string): string[] {
  const out: string[] = [];
  const startMs = Date.parse(`${since}T00:00:00.000Z`);
  const endMs = Date.parse(`${until}T00:00:00.000Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return out;
  const oneDay = 24 * 60 * 60 * 1000;
  for (let ms = startMs; ms <= endMs; ms += oneDay) {
    out.push(new Date(ms).toISOString().slice(0, 10));
  }
  return out;
}

// ─── HTTP + classifying ────────────────────────────────────────────────────

interface FetchOptions {
  method?: "GET" | "POST";
  body?: string;
}

interface RawFetchSuccess {
  ok: true;
  body: unknown;
}
type RawFetchResult = RawFetchSuccess | GhlFetchFailure;

// ─── Rate limiting (GHL v2: ~100 req / 10s por location) ───────────────────

/**
 * GHL v2 aplica un burst limit por location (~100 requests cada 10s) además
 * del cap diario. El sync dispara tres fetchers en paralelo contra la MISMA
 * location — daily counts (1 request por día del launch), contacts paginado y
 * conversations paginado — y cada uno pagina en loop cerrado sin pausa. Eso
 * supera el burst en segundos, GHL empieza a devolver 429 en cadena y como
 * `rate_limited` se propaga hacia arriba, el sync entero aborta.
 *
 * Cada PIT corresponde a una location, así que la cuota se administra por
 * token: como mucho MAX_CONCURRENT_REQUESTS en vuelo y RATE_MAX_IN_WINDOW por
 * ventana de 10s. El techo queda debajo del límite real a propósito — los
 * webhooks y otras instancias del deploy comparten la misma cuota.
 */
const RATE_WINDOW_MS = 10_000;
const RATE_MAX_IN_WINDOW = 70;
const MAX_CONCURRENT_REQUESTS = 5;
const MAX_429_RETRIES = 4;
const RETRY_BASE_DELAY_MS = 1_000;
const RETRY_MAX_DELAY_MS = 30_000;

class GhlRateLimiter {
  private recent: number[] = [];
  private active = 0;
  private waiters: Array<() => void> = [];
  private pausedUntil = 0;

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /**
   * Frena TODAS las requests de esta location, no sólo la que comió el 429.
   * Sin esto los otros fetchers en vuelo siguen martillando mientras el que
   * falló espera su backoff, y el 429 se vuelve permanente.
   */
  penalize(delayMs: number): void {
    this.pausedUntil = Math.max(this.pausedUntil, Date.now() + delayMs);
  }

  private async acquire(): Promise<void> {
    for (;;) {
      const now = Date.now();

      if (now < this.pausedUntil) {
        await sleep(this.pausedUntil - now);
        continue;
      }

      this.recent = this.recent.filter((t) => now - t < RATE_WINDOW_MS);

      if (
        this.active < MAX_CONCURRENT_REQUESTS &&
        this.recent.length < RATE_MAX_IN_WINDOW
      ) {
        this.active++;
        this.recent.push(now);
        return;
      }

      if (this.recent.length >= RATE_MAX_IN_WINDOW) {
        // Ventana llena: esperamos a que expire la request más vieja.
        await sleep(RATE_WINDOW_MS - (now - this.recent[0]!) + 25);
        continue;
      }

      // Sólo falta cupo de concurrencia: nos despierta el próximo release().
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }

  private release(): void {
    this.active--;
    this.waiters.shift()?.();
  }
}

const limiters = new Map<string, GhlRateLimiter>();

function limiterFor(token: string): GhlRateLimiter {
  let limiter = limiters.get(token);
  if (!limiter) {
    limiter = new GhlRateLimiter();
    limiters.set(token, limiter);
  }
  return limiter;
}

/**
 * Cuánto esperar antes del próximo intento. Si GHL mandó `Retry-After` lo
 * respetamos (capado); si no, backoff exponencial con jitter para que los
 * fetchers concurrentes no reintenten todos en el mismo milisegundo.
 */
function backoffDelayMs(
  attempt: number,
  retryAfterSeconds: number | null,
): number {
  if (retryAfterSeconds !== null && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds * 1000, RETRY_MAX_DELAY_MS);
  }
  const exponential = Math.min(
    RETRY_BASE_DELAY_MS * 2 ** attempt,
    RETRY_MAX_DELAY_MS,
  );
  return exponential + Math.floor(Math.random() * 250);
}

/**
 * Entry point de todas las llamadas a GHL: pasa por el limiter de la location
 * y reintenta los 429 con backoff. Sólo devuelve `rate_limited` al caller
 * cuando se agotaron los reintentos — recién ahí el sync debe abortar.
 */
async function ghlFetch(
  url: string,
  token: string,
  opts: FetchOptions = {},
): Promise<RawFetchResult> {
  const limiter = limiterFor(token);
  let lastFailure: GhlFetchFailure | null = null;

  for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
    const result = await limiter.run(() => ghlFetchOnce(url, token, opts));
    if (result.ok || result.kind !== "rate_limited") return result;

    lastFailure = result;
    if (attempt === MAX_429_RETRIES) break;

    const delayMs = backoffDelayMs(attempt, result.retryAfterSeconds ?? null);
    limiter.penalize(delayMs);
    await sleep(delayMs);
  }

  return {
    ...lastFailure!,
    detail: {
      ...lastFailure!.detail,
      attempts: MAX_429_RETRIES + 1,
      retries_exhausted: true,
    },
  };
}

async function ghlFetchOnce(
  url: string,
  token: string,
  opts: FetchOptions = {},
): Promise<RawFetchResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Version: GHL_API_VERSION,
        Accept: "application/json",
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
      },
      body: opts.body,
      cache: "no-store",
    });
  } catch (err) {
    return {
      ok: false,
      kind: "error",
      message: err instanceof Error ? err.message : "Network error",
      detail: { cause: "network" },
    };
  }

  // Cualquier respuesta no-OK: capturamos el body crudo en `responseBody` para
  // que el orchestrator, al hacer merge con su propio `message`, no pise lo
  // que GHL haya mandado en el cuerpo.
  if (res.status === 401 || res.status === 403) {
    const body = await safeJson(res);
    // Diferenciar token roto vs hipo de red. GHL a veces devuelve 401 con
    // body { message: "Command timed out", ... } cuando se les cayó un
    // backend interno — NO es problema del token. Si lo clasificamos como
    // token_invalid, la UI marca la conexión como "Reconectar" y obliga al
    // usuario a regenerar el PIT por nada. Tratamos esos como 'error'
    // transient para que la UI muestre "Error, reintentá".
    if (isTransientUpstreamMessage(body)) {
      return {
        ok: false,
        kind: "error",
        message: `GHL respondió ${res.status} con error transient (${describeTransient(body)})`,
        detail: {
          httpStatus: res.status,
          url,
          responseBody: body,
          cause: "upstream_transient",
        },
      };
    }
    return {
      ok: false,
      kind: "token_invalid",
      message: `GHL respondió ${res.status}`,
      detail: {
        httpStatus: res.status,
        url,
        responseBody: body,
      },
    };
  }

  // 429 = rate limited. Retry-After viene en segundos cuando el server lo
  // setea; algunos endpoints no lo mandan, en cuyo caso queda null.
  if (res.status === 429) {
    const retryAfter = res.headers.get("retry-after");
    const retryAfterSeconds = retryAfter ? parseInt(retryAfter, 10) : null;
    return {
      ok: false,
      kind: "rate_limited",
      message: "GHL rate limit (429)",
      detail: {
        httpStatus: 429,
        url,
        responseBody: await safeJson(res),
      },
      retryAfterSeconds: Number.isFinite(retryAfterSeconds ?? NaN)
        ? retryAfterSeconds
        : null,
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      kind: "error",
      message: `GHL respondió ${res.status}`,
      detail: {
        httpStatus: res.status,
        url,
        responseBody: await safeJson(res),
      },
    };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return {
      ok: false,
      kind: "error",
      message: "Respuesta de GHL no es JSON válido",
      detail: { cause: "json_parse" },
    };
  }
  return { ok: true, body };
}

/**
 * Heurística para detectar 401/403 que en realidad son fallos transient del
 * backend de GHL, no problemas de credencial. Si el body contiene "timed out",
 * "timeout" o "command timeout", tratamos como error transient — el token
 * sigue siendo válido, el próximo intento probablemente ande.
 *
 * Tokens realmente inválidos devuelven mensajes tipo "Invalid token",
 * "Unauthorized", "expired", etc. — esos pasan al path token_invalid.
 */
function isTransientUpstreamMessage(body: Record<string, unknown>): boolean {
  const msg = extractMessage(body)?.toLowerCase();
  if (!msg) return false;
  return (
    msg.includes("timed out") ||
    msg.includes("timeout") ||
    msg.includes("command timeout")
  );
}

function describeTransient(body: Record<string, unknown>): string {
  return extractMessage(body) ?? "upstream transient";
}

function extractMessage(body: Record<string, unknown>): string | null {
  const m = body.message;
  if (typeof m === "string" && m.length > 0) return m;
  return null;
}

async function safeJson(res: Response): Promise<Record<string, unknown>> {
  try {
    const j = await res.json();
    if (j && typeof j === "object") return j as Record<string, unknown>;
    return { body: j };
  } catch {
    return { body: "non-json" };
  }
}

// ─── helpers de shape ──────────────────────────────────────────────────────

/**
 * GHL es inconsistente en cómo devuelve las colecciones: a veces el envelope
 * es `{ events: [...] }`, otras `{ conversations: [...] }`, otras `{ data:
 * [...] }`. Esta función prueba claves en orden y devuelve el primer array
 * encontrado.
 */
function extractArray(body: unknown, keys: ReadonlyArray<string>): unknown[] {
  if (Array.isArray(body)) return body;
  if (typeof body !== "object" || body === null) return [];
  const obj = body as Record<string, unknown>;
  for (const k of keys) {
    if (Array.isArray(obj[k])) return obj[k] as unknown[];
  }
  // Algunos endpoints anidan en `data`. Lo probamos como fallback.
  if (Array.isArray(obj.data)) return obj.data as unknown[];
  return [];
}

/**
 * Extrae el teléfono del contacto. GHL anida diferente según endpoint:
 *   - calendar event: `contact.phone` o `phone` o `contactPhone`
 *   - conversation: `phone` directo, o adentro de `contact`
 * Devolvemos lo primero que aparezca como string.
 */
function extractPhone(obj: Record<string, unknown>): string | null {
  // Directo
  const direct = strOrNull(obj.phone) ?? strOrNull(obj.contactPhone);
  if (direct) return direct;
  // Anidado en contact
  const contact = obj.contact;
  if (typeof contact === "object" && contact !== null) {
    const c = contact as Record<string, unknown>;
    return strOrNull(c.phone) ?? strOrNull(c.phoneNumber);
  }
  return null;
}

function extractContactName(obj: Record<string, unknown>): string {
  // Prioridad: nombre del contacto > nombre directo > title (que en calendar
  // events suele ser "Sesión con X" en vez del nombre puro). Si el evento NO
  // tiene contacto asociado (ej. bloqueo personal), caemos a title como
  // fallback informativo.
  const contact = obj.contact;
  if (typeof contact === "object" && contact !== null) {
    const c = contact as Record<string, unknown>;
    const cn =
      strOrNull(c.name) ??
      strOrNull(c.fullName) ??
      joinName(strOrNull(c.firstName), strOrNull(c.lastName));
    if (cn) return cn;
  }
  const direct =
    strOrNull(obj.contactName) ??
    strOrNull(obj.fullName) ??
    joinName(strOrNull(obj.firstName), strOrNull(obj.lastName));
  if (direct) return direct;
  // Fallback a title — solo si no hay ningún name extraíble.
  return strOrNull(obj.title) ?? "Contacto sin nombre";
}

function joinName(first: string | null, last: string | null): string | null {
  const joined = [first, last].filter(Boolean).join(" ").trim();
  return joined === "" ? null : joined;
}

function strOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Extrae el `country` de un contact GHL y lo valida como ISO-2 (2 letras
 * alfa, uppercase). Dump real: GHL emite "AR", "MX", etc. (verificado Fase
 * B). Cualquier otro valor (null, vacío, "Argentina", "ARG") → null para
 * no pasarle basura a libphonenumber. El caller decide qué hacer cuando
 * es null (parsear E.164-only sin asumir país).
 */
export function extractCountryIso2(obj: Record<string, unknown>): string | null {
  const raw = obj.country;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * GHL es inconsistente con los timestamps: el endpoint de Contacts devuelve
 * ISO strings ("2026-06-07T12:34:56Z"), pero el de Conversations los devuelve
 * como epoch ms (number). Si tratamos un number con `strOrNull` cae a null y
 * perdemos toda la señal de fecha (bug observado en runtime: warm_signals=0
 * con 20k conversaciones inbound reales). Este helper normaliza ambos shapes
 * a ISO string para que el resto del código (Date.parse, comparaciones con
 * sinceMs/untilMs/warmWindow) funcione igual sin importar la fuente.
 */
function parseGhlDate(v: unknown): string | null {
  if (typeof v === "string") {
    const trimmed = v.trim();
    return trimmed === "" ? null : trimmed;
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    return new Date(v).toISOString();
  }
  return null;
}

function parseDirection(v: unknown): "inbound" | "outbound" | null {
  if (typeof v !== "string") return null;
  const lower = v.toLowerCase();
  if (lower === "inbound") return "inbound";
  if (lower === "outbound") return "outbound";
  return null;
}

function numOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * GHL identifica WhatsApp con `type` tipo `TYPE_PHONE`/`TYPE_WHATSAPP`,
 * dependiendo del setup. Hacemos un match laxo por substring "whatsapp"
 * para no romper si GHL cambia los strings.
 */
function isWhatsAppType(type: string | null): boolean {
  if (!type) return false;
  return type.toLowerCase().includes("whatsapp");
}

function dateToEpochStart(dateStr: string): number {
  // 2026-06-12 → 2026-06-12T00:00:00.000Z
  return Date.parse(`${dateStr}T00:00:00.000Z`);
}

function dateToEpochEnd(dateStr: string): number {
  // Inclusivo: hasta el final del día.
  return Date.parse(`${dateStr}T23:59:59.999Z`);
}
