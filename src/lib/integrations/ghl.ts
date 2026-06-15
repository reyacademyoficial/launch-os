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

export interface GhlAppointment {
  /** Id del calendario event (idempotencia). */
  id: string;
  /** contactId del lead asociado al appointment (puede faltar en bloqueos sin contacto). */
  contactId: string | null;
  /** Teléfono CRUDO del contacto. Puede ser null si el contacto no tiene phone. */
  rawPhone: string | null;
  /** Nombre del contacto, displayable. Fallback a "Contacto sin nombre". */
  contactName: string;
  /** ISO timestamp del comienzo del appointment. */
  startTime: string | null;
  /**
   * Status del evento según GHL: 'confirmed' | 'cancelled' | 'noshow' |
   * 'completed' | 'pending' | etc. Usado por el matcher para NO agendar leads
   * cuyo appointment fue cancelado o noshow.
   */
  status: string | null;
  /** El item crudo, para `leads.notes` o debug. */
  raw: unknown;
}

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

/**
 * Metadata de debug propio de la rama appointments. Acompaña a `rows` para
 * que el run del sync pueda mostrar dónde se cayó la cuenta (ej. "GHL trajo
 * 0 calendars" vs "GHL trajo 5 calendars pero 0 events" vs "trajo events
 * pero ninguno mappeable porque viene en otro shape").
 */
export interface AppointmentsMeta {
  calendars_found: number;
  sample_calendar_ids: string[];
  users_found: number;
  sample_user_ids: string[];
  raw_events_total: number;
  raw_events_by_source: { from_calendars: number; from_users: number };
  sample_event_keys: string[];
  source_errors: number;
  /** Ventana que mandamos a GHL — para descartar el caso "appointments fuera del rango". */
  window: {
    start_iso: string;
    end_iso: string;
    start_ms: number;
    end_ms: number;
  };
  /** Keys top-level del primer response body. Si no es `events`, acá se ve. */
  sample_response_keys: string[];
  /** Counts por key conocida en el body. Detectamos si GHL usa otro nombre. */
  array_keys_observed: Record<string, number>;
}

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

export interface GhlOpportunity {
  id: string;
  contactId: string | null;
  pipelineId: string | null;
  pipelineStageId: string | null;
  /** GHL emite cuatro valores discretos. Cualquier otro lo mapeamos a null y la fila se descarta arriba. */
  status: "open" | "won" | "lost" | "abandoned";
  /** Valor monetario crudo de GHL. Null si la opp no tiene valor asignado. */
  monetaryValue: number | null;
  /** `source` textual de GHL (ej. "whatsapp", "facebook", "manual"). Para v2 del split. */
  source: string | null;
  /** GHL user id del closer. Mismo flujo que contact.assignedTo → ghl_user_mappings. */
  assignedTo: string | null;
  /**
   * ISO timestamp del momento en que la opp pasó a `status='won'`. Derivado de
   * `lastStatusChangeAt` solo cuando el status final es 'won' — para cualquier
   * otro status queda null. Usado por el agregado para decidir si la opp cae
   * en la ventana del launch (decisión 2.a).
   */
  wonAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  raw: unknown;
}

export interface OpportunitiesMeta {
  pages_fetched: number;
  raw_total: number;
  sample_opp_keys: string[];
  /** Status crudos observados — sirve para detectar si GHL agrega valores nuevos. */
  observed_statuses: string[];
  /** Sources crudos — para mapear el v2 del split WhatsApp. */
  observed_sources: string[];
  /** Pipelines distintos — útil para el config futuro "cuál pipeline = WhatsApp". */
  observed_pipeline_ids: string[];
  /** Cuántas opps del fetch están en `status='won'` y dentro de la ventana del launch. */
  won_in_window: number;
  /** Suma de `monetaryValue` de las won_in_window. */
  won_revenue_in_window: number;
  stopped_by_date_cutoff: boolean;
  hit_max_pages: boolean;
}

interface FetchArgs {
  token: string;
  locationId: string;
  since: string; // YYYY-MM-DD
  until: string; // YYYY-MM-DD
}

// ─── Calendars (descubrimiento) + Appointments ─────────────────────────────

/**
 * Trae appointments en `[since, until]` para TODOS los calendars del location.
 *
 * Por qué este 2-step (list calendars → list events per calendar):
 *   `GET /calendars/events` de v2 NO acepta `locationId` solo. Exige uno de
 *   `calendarId`, `userId` o `groupId` además de la ventana. Si mandás solo
 *   locationId, GHL responde 422 sin detalle ("Unprocessable Entity").
 *
 *   En vez de pedirle al usuario que ingrese un calendarId a mano (frágil:
 *   los subaccounts suelen tener varios), descubrimos todos los calendars
 *   y agregamos sus eventos. Es 1 + N requests, pero N es chico (típicamente
 *   < 5 calendars por subaccount).
 *
 * Errores: si list-calendars falla (auth/rate), propagamos. Si un calendar
 * individual falla, lo registramos en `detail.partial_calendar_errors` pero
 * seguimos con los demás (no rompemos el sync entero por un solo calendar).
 */
export async function fetchGhlAppointments(
  args: FetchArgs,
): Promise<
  | { ok: true; rows: GhlAppointment[]; meta: AppointmentsMeta }
  | GhlFetchFailure
> {
  // Pedimos calendars Y users en paralelo. En GHL los appointments quedan en
  // calendars de usuarios (setters/closers), no en los Calendar Resources
  // del location — por eso una sola fuente puede dar `events: []` aunque
  // haya appointments reales.
  const [calsResult, usersResult] = await Promise.all([
    fetchGhlCalendars(args.token, args.locationId),
    fetchGhlUsers(args.token, args.locationId),
  ]);
  if (!calsResult.ok) return calsResult;
  if (!usersResult.ok) return usersResult;

  const startMs = dateToEpochStart(args.since);
  const endMs = dateToEpochEnd(args.until);

  const meta: AppointmentsMeta = {
    calendars_found: calsResult.rows.length,
    sample_calendar_ids: calsResult.rows.slice(0, 5).map((c) => c.id),
    users_found: usersResult.rows.length,
    sample_user_ids: usersResult.rows.slice(0, 5).map((u) => u.id),
    raw_events_total: 0,
    raw_events_by_source: { from_calendars: 0, from_users: 0 },
    sample_event_keys: [],
    source_errors: 0,
    window: {
      start_iso: args.since,
      end_iso: args.until,
      start_ms: startMs,
      end_ms: endMs,
    },
    sample_response_keys: [],
    array_keys_observed: {},
  };

  const allRows: GhlAppointment[] = [];
  let sampleSeen = false;

  // Helper: pide events para un (key, id) y los acumula.
  // Antes corría dentro de dos `for await` secuenciales: con 5 calendars + 10
  // users eso eran 15 round-trips a GHL en serie. Ahora se ejecutan todos en
  // paralelo con concurrency 5 (medido contra el rate limit típico de GHL).
  async function pullFor(
    paramKey: "calendarId" | "userId",
    id: string,
    countAgainst: "from_calendars" | "from_users",
  ): Promise<
    | { ok: true }
    | { ok: false; kind: "token_invalid" | "rate_limited"; failure: GhlFetchFailure }
  > {
    const params = new URLSearchParams({
      locationId: args.locationId,
      [paramKey]: id,
      startTime: String(startMs),
      endTime: String(endMs),
    });
    const url = `${GHL_API_BASE}/calendars/events?${params.toString()}`;
    const result = await ghlFetch(url, args.token);
    if (!result.ok) {
      if (result.kind === "token_invalid" || result.kind === "rate_limited") {
        return { ok: false, kind: result.kind, failure: result };
      }
      meta.source_errors++;
      return { ok: true };
    }
    // Diagnóstico de shape: capturamos las keys del primer response que veamos,
    // y por cada response anotamos cuáles keys son arrays + su tamaño. Si GHL
    // emite los appointments en otra key (ej. "appointments"), se ve acá.
    if (
      meta.sample_response_keys.length === 0 &&
      typeof result.body === "object" &&
      result.body !== null
    ) {
      meta.sample_response_keys = Object.keys(
        result.body as Record<string, unknown>,
      );
    }
    if (typeof result.body === "object" && result.body !== null) {
      for (const [k, v] of Object.entries(result.body as Record<string, unknown>)) {
        if (Array.isArray(v)) {
          meta.array_keys_observed[k] =
            (meta.array_keys_observed[k] ?? 0) + v.length;
        }
      }
    }

    const rawEvents = extractArray(result.body, ["events"]);
    meta.raw_events_total += rawEvents.length;
    meta.raw_events_by_source[countAgainst] += rawEvents.length;

    if (!sampleSeen && rawEvents.length > 0) {
      const first = rawEvents[0];
      if (first && typeof first === "object") {
        meta.sample_event_keys = Object.keys(first as Record<string, unknown>);
        sampleSeen = true;
      }
    }
    for (const row of parseAppointmentsBody({ events: rawEvents })) {
      allRows.push(row);
    }
    return { ok: true };
  }

  // Construimos la lista de jobs (calendarId/userId) y los ejecutamos con
  // concurrency limitada. Si alguno falla con token_invalid/rate_limited
  // propagamos el primer error encontrado (no tiene sentido seguir tirando
  // contra una API que ya nos rechazó).
  type Job = {
    paramKey: "calendarId" | "userId";
    id: string;
    countAgainst: "from_calendars" | "from_users";
  };
  const jobs: Job[] = [
    ...calsResult.rows.map((c): Job => ({
      paramKey: "calendarId",
      id: c.id,
      countAgainst: "from_calendars",
    })),
    ...usersResult.rows.map((u): Job => ({
      paramKey: "userId",
      id: u.id,
      countAgainst: "from_users",
    })),
  ];

  let cursor = 0;
  let propagated: GhlFetchFailure | null = null;
  const workers = Array.from({ length: Math.min(5, jobs.length) }, async () => {
    while (true) {
      if (propagated) return;
      const i = cursor++;
      if (i >= jobs.length) return;
      const j = jobs[i]!;
      const r = await pullFor(j.paramKey, j.id, j.countAgainst);
      if (!r.ok && !propagated) propagated = r.failure;
    }
  });
  await Promise.all(workers);
  if (propagated) return propagated;

  // De-dup por event.id (el mismo appointment puede aparecer como event del
  // calendar Y como event del user assigned).
  const seen = new Set<string>();
  const deduped = allRows.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });

  return { ok: true, rows: deduped, meta };
}

/**
 * Lista users del location. La API devuelve `{ users: [...] }`. Si el PIT no
 * tiene scope `View Users`, falla con 401/403 → propagamos como token_invalid
 * y el caller (appointments) corta.
 *
 * Export público: la UI de mapeo de vendedores (GHL user ↔ team_member) lo
 * llama desde un Server Action para listar los users disponibles.
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

interface GhlCalendarRef {
  id: string;
  name: string;
}

/**
 * Lista todos los calendars del location. La API devuelve `{ calendars: [...] }`.
 * Falla → propagamos el GhlFetchFailure tal cual.
 */
async function fetchGhlCalendars(
  token: string,
  locationId: string,
): Promise<GhlFetchResult<GhlCalendarRef>> {
  const url = `${GHL_API_BASE}/calendars/?locationId=${encodeURIComponent(locationId)}`;
  const result = await ghlFetch(url, token);
  if (!result.ok) return result;

  const cals = extractArray(result.body, ["calendars"]);
  const rows: GhlCalendarRef[] = [];
  for (const item of cals) {
    if (typeof item !== "object" || item === null) continue;
    const c = item as Record<string, unknown>;
    const id = strOrNull(c.id);
    if (!id) continue;
    rows.push({ id, name: strOrNull(c.name) ?? id });
  }
  return { ok: true, rows };
}

/**
 * Trae las conversaciones de UN contact específico. Endpoint dedicado para la
 * detección de tibio en el sync: por cada contact incremental hacemos UNA
 * sola request acotada al contactId — barata, no requiere paginar 20k.
 *
 * GHL responde un array de conversations del contact (típicamente 1-3:
 * WhatsApp + email + SMS). No paginamos: limit=100 es más que suficiente.
 *
 * El consumer usa `lastInboundWhatsappMessageDate` (que viene en cada
 * conversation) para decidir si el lead respondió en la ventana del launch.
 */
export async function fetchGhlContactConversations(
  token: string,
  locationId: string,
  contactId: string,
): Promise<GhlFetchResult<GhlConversation>> {
  const params = new URLSearchParams({
    locationId,
    contactId,
    limit: "100",
  });
  const url = `${GHL_API_BASE}/conversations/search?${params.toString()}`;
  const result = await ghlFetch(url, token);
  if (!result.ok) return result;

  const rawItems = extractArray(result.body, ["conversations"]);
  const rows: GhlConversation[] = [];
  for (const item of rawItems) {
    if (typeof item !== "object" || item === null) continue;
    const conv = item as Record<string, unknown>;
    const id = strOrNull(conv.id);
    if (!id) continue;
    rows.push({
      id,
      contactId: strOrNull(conv.contactId),
      rawPhone: extractPhone(conv),
      contactName: extractContactName(conv),
      type: strOrNull(conv.type) ?? strOrNull(conv.lastMessageType),
      lastMessageDate: strOrNull(conv.lastMessageDate),
      lastMessageType: strOrNull(conv.lastMessageType),
      lastMessageDirection: parseDirection(conv.lastMessageDirection),
      lastInboundWhatsappMessageDate: strOrNull(conv.lastInboundWhatsappMessageDate),
      unreadCount: numOrNull(conv.unreadCount),
      raw: conv,
    });
  }
  return { ok: true, rows };
}

/** Pure function — testeable contra fixtures sin mockear fetch. */
export function parseAppointmentsBody(body: unknown): GhlAppointment[] {
  const events = extractArray(body, ["events"]);
  const rows: GhlAppointment[] = [];
  for (const item of events) {
    if (typeof item !== "object" || item === null) continue;
    const evt = item as Record<string, unknown>;
    const id = strOrNull(evt.id);
    if (!id) continue;

    // GHL emite el status en `appointmentStatus` (calendar/events v2).
    // Algunos endpoints/versiones también usan `status` plano — probamos los
    // dos para tolerar variaciones.
    const status =
      strOrNull(evt.appointmentStatus) ?? strOrNull(evt.status);

    rows.push({
      id,
      contactId: strOrNull(evt.contactId),
      rawPhone: extractPhone(evt),
      contactName: extractContactName(evt),
      startTime: strOrNull(evt.startTime),
      status,
      raw: evt,
    });
  }
  return rows;
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

      const lastIso = strOrNull(conv.lastMessageDate);
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
        lastInboundWhatsappMessageDate: strOrNull(conv.lastInboundWhatsappMessageDate),
        unreadCount: numOrNull(conv.unreadCount),
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

/**
 * Cuenta mensajes INBOUND de una conversación específica. Hace falta para
 * decidir frío (1 msg del lead) vs tibio (2+). GHL pagina los mensajes de
 * a 100; para el conteo paginamos hasta cortar (con un tope defensivo).
 *
 * `messageCount` es el conteo de INBOUND solamente. Direction se determina
 * por el campo `direction` del mensaje (`inbound` | `outbound`).
 */
export async function fetchGhlInboundMessageCount(
  token: string,
  conversationId: string,
): Promise<number | null> {
  const MAX_MSG_PAGES = 10; // hasta 1000 mensajes; suficiente
  let inbound = 0;
  let lastId: string | null = null;
  for (let page = 0; page < MAX_MSG_PAGES; page++) {
    const params = new URLSearchParams({ limit: "100" });
    if (lastId) params.set("lastMessageId", lastId);
    const url = `${GHL_API_BASE}/conversations/${encodeURIComponent(
      conversationId,
    )}/messages?${params.toString()}`;
    const result = await ghlFetch(url, token);
    if (!result.ok) {
      // No abortamos el sync por un conteo fallido — fallback a null y el
      // caller decide (lo trata como frío por defecto).
      return null;
    }
    const body = result.body as Record<string, unknown> | null;
    const messages = body && Array.isArray((body as Record<string, unknown>).messages)
      ? ((body as { messages: unknown[] }).messages)
      : extractArray(result.body, ["messages"]);

    if (messages.length === 0) break;
    for (const m of messages) {
      if (typeof m !== "object" || m === null) continue;
      const obj = m as Record<string, unknown>;
      if (strOrNull(obj.direction) === "inbound") inbound++;
    }
    const lastMsg = messages[messages.length - 1];
    if (typeof lastMsg === "object" && lastMsg !== null) {
      lastId = strOrNull((lastMsg as Record<string, unknown>).id);
    }
    if (messages.length < 100 || !lastId) break;
  }
  return inbound;
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

  for (let page = 0; page < MAX_PAGES; page++) {
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

    // Última iteración antes de agotar MAX_PAGES → señalamos truncado para
    // que el diagnóstico del run lo refleje.
    if (page === MAX_PAGES - 1) {
      meta.hit_max_pages = true;
    }
  }

  meta.observed_tags = Array.from(tagsSet);
  return { ok: true, rows: out, meta };
}

// ─── Opportunities (pipelines de venta) ────────────────────────────────────

export interface OpportunitiesFetchArgs extends FetchArgs {
  cutoffIso?: string | null;
}

/**
 * Lista opportunities del location ordenadas por `date_updated desc`. Pagina
 * con `page`/`limit` (GHL no usa cursor en este endpoint, paginación numérica).
 * Cortocircuito por `updatedAt < cutoffEfectivo`.
 *
 * Ventana: NO filtramos server-side por fecha — la `won_at` de una opp puede
 * estar dentro de la ventana del launch aunque `dateUpdated` no (ej. opp won
 * hace 3 meses, status cambió hace 1 día y el filtro updated la captura, pero
 * won_at sigue siendo viejo). Filtramos client-side al agregar.
 *
 * Idempotencia/incremental: igual que contacts. Sin cutoff trae todo el
 * histórico paginado (primera corrida); con cutoff corta al cruzar el último
 * `updatedAt` ya procesado.
 *
 * Endpoint param: GHL v2 usa `location_id` snake_case acá (inconsistente con
 * `locationId` camelCase del resto del API — verificable en `array_keys_observed`).
 */
export async function fetchGhlOpportunities(
  args: OpportunitiesFetchArgs,
): Promise<
  | { ok: true; rows: GhlOpportunity[]; meta: OpportunitiesMeta }
  | GhlFetchFailure
> {
  const sinceMs = dateToEpochStart(args.since);
  const untilMs = dateToEpochEnd(args.until);
  const cutoffMs = args.cutoffIso ? Date.parse(args.cutoffIso) : null;
  // Para opportunities el cutoff NO debe acotar a `sinceMs`: necesitamos ver
  // opps con dateUpdated cualquiera para que el agregado decida con `won_at`.
  // Si hay cutoff (corrida incremental), respetarlo; si no, traemos todo.
  const effectiveCutoff =
    cutoffMs !== null && Number.isFinite(cutoffMs) ? cutoffMs : null;

  const meta: OpportunitiesMeta = {
    pages_fetched: 0,
    raw_total: 0,
    sample_opp_keys: [],
    observed_statuses: [],
    observed_sources: [],
    observed_pipeline_ids: [],
    won_in_window: 0,
    won_revenue_in_window: 0,
    stopped_by_date_cutoff: false,
    hit_max_pages: false,
  };
  const statusesSet = new Set<string>();
  const sourcesSet = new Set<string>();
  const pipelinesSet = new Set<string>();
  const out: GhlOpportunity[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const params = new URLSearchParams({
      location_id: args.locationId,
      limit: String(PAGE_SIZE),
      page: String(page),
      sort: "date_updated",
      sort_direction: "desc",
      status: "all",
    });
    const url = `${GHL_API_BASE}/opportunities/search?${params.toString()}`;
    const result = await ghlFetch(url, args.token);
    if (!result.ok) return result;

    const rawItems = extractArray(result.body, ["opportunities"]);
    meta.pages_fetched++;
    meta.raw_total += rawItems.length;

    if (meta.sample_opp_keys.length === 0 && rawItems[0]) {
      meta.sample_opp_keys = Object.keys(
        rawItems[0] as Record<string, unknown>,
      );
    }

    if (rawItems.length === 0) break;

    // Parseo puro (reutilizable y testeable). Meta + cortocircuito se hacen
    // a partir del row ya parseado.
    const parsed = parseOpportunitiesBody({ opportunities: rawItems });
    let oldestThisPageMs = Number.POSITIVE_INFINITY;

    for (let i = 0; i < parsed.length; i++) {
      const row = parsed[i]!;
      const raw = row.raw as Record<string, unknown>;

      const statusRaw = strOrNull(raw.status);
      if (statusRaw) statusesSet.add(statusRaw);
      if (row.source) sourcesSet.add(row.source);
      if (row.pipelineId) pipelinesSet.add(row.pipelineId);

      if (row.updatedAt) {
        const updatedMs = Date.parse(row.updatedAt);
        if (Number.isFinite(updatedMs)) {
          oldestThisPageMs = Math.min(oldestThisPageMs, updatedMs);
        }
      }

      out.push(row);

      // Contador en-window — feed para el summary del run (no se pisa con el
      // agregado del KPI page, que lee directo de DB; este es solo telemetría).
      if (row.wonAt) {
        const wonMs = Date.parse(row.wonAt);
        if (
          Number.isFinite(wonMs) &&
          wonMs >= sinceMs &&
          wonMs <= untilMs
        ) {
          meta.won_in_window++;
          if (row.monetaryValue !== null) {
            meta.won_revenue_in_window += row.monetaryValue;
          }
        }
      }
    }

    if (
      effectiveCutoff !== null &&
      Number.isFinite(oldestThisPageMs) &&
      oldestThisPageMs < effectiveCutoff
    ) {
      meta.stopped_by_date_cutoff = true;
      break;
    }
    if (rawItems.length < PAGE_SIZE) break;
    if (page === MAX_PAGES) {
      meta.hit_max_pages = true;
    }
  }

  meta.observed_statuses = Array.from(statusesSet);
  meta.observed_sources = Array.from(sourcesSet);
  meta.observed_pipeline_ids = Array.from(pipelinesSet);
  return { ok: true, rows: out, meta };
}

/**
 * Pure function — testeable contra fixtures sin mockear fetch. Mismo patrón
 * que `parseAppointmentsBody` y `parseConversationsBody`. NO aplica filtro de
 * ventana ni cutoff incremental — eso vive en `fetchGhlOpportunities`.
 */
export function parseOpportunitiesBody(body: unknown): GhlOpportunity[] {
  const items = extractArray(body, ["opportunities"]);
  const rows: GhlOpportunity[] = [];
  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    const id = strOrNull(o.id);
    if (!id) continue;

    const status = parseOpportunityStatus(o.status);
    if (!status) continue;

    const lastStatusChange =
      strOrNull(o.lastStatusChangeAt) ??
      strOrNull(o.lastStatusChangeDate) ??
      strOrNull(o.last_status_change_date);

    rows.push({
      id,
      contactId: strOrNull(o.contactId) ?? strOrNull(o.contact_id),
      pipelineId: strOrNull(o.pipelineId) ?? strOrNull(o.pipeline_id),
      pipelineStageId:
        strOrNull(o.pipelineStageId) ?? strOrNull(o.pipeline_stage_id),
      status,
      monetaryValue: numOrNullLoose(o.monetaryValue),
      source: strOrNull(o.source),
      assignedTo: strOrNull(o.assignedTo) ?? strOrNull(o.assigned_to),
      wonAt: status === "won" ? lastStatusChange : null,
      createdAt:
        strOrNull(o.createdAt) ??
        strOrNull(o.dateAdded) ??
        strOrNull(o.created_at),
      updatedAt:
        strOrNull(o.updatedAt) ??
        strOrNull(o.dateUpdated) ??
        strOrNull(o.updated_at),
      raw: o,
    });
  }
  return rows;
}

function parseOpportunityStatus(
  v: unknown,
): GhlOpportunity["status"] | null {
  if (typeof v !== "string") return null;
  const lower = v.trim().toLowerCase();
  if (
    lower === "open" ||
    lower === "won" ||
    lower === "lost" ||
    lower === "abandoned"
  ) {
    return lower;
  }
  return null;
}

/**
 * Variante de numOrNull que también acepta números fraccionarios (decimales).
 * `numOrNull` usa `parseInt` y trunca; los `monetaryValue` de GHL pueden venir
 * con decimales (ej. 1499.99) y no queremos perder centavos.
 */
function numOrNullLoose(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Pure function — testeable contra fixtures sin mockear fetch. */
export function parseConversationsBody(
  body: unknown,
  sinceMs: number,
  untilMs: number,
): GhlConversation[] {
  const items = extractArray(body, ["conversations"]);
  const rows: GhlConversation[] = [];
  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    const conv = item as Record<string, unknown>;
    const id = strOrNull(conv.id);
    if (!id) continue;

    const type = strOrNull(conv.type);
    if (!isWhatsAppType(type)) continue;

    const lastIso = strOrNull(conv.lastMessageDate);
    if (lastIso) {
      const lastMs = Date.parse(lastIso);
      if (Number.isFinite(lastMs) && (lastMs < sinceMs || lastMs > untilMs)) {
        continue;
      }
    }

    rows.push({
      id,
      contactId: strOrNull(conv.contactId),
      rawPhone: extractPhone(conv),
      contactName: extractContactName(conv),
      type,
      lastMessageDate: lastIso,
      lastMessageType: strOrNull(conv.lastMessageType),
      lastMessageDirection: parseDirection(conv.lastMessageDirection),
      lastInboundWhatsappMessageDate: strOrNull(conv.lastInboundWhatsappMessageDate),
      unreadCount: numOrNull(conv.unreadCount),
      raw: conv,
    });
  }
  return rows;
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

async function ghlFetch(
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
