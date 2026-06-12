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
  /** Teléfono CRUDO del contacto. Puede ser null si el contacto no tiene phone. */
  rawPhone: string | null;
  /** Nombre del contacto, displayable. Fallback a "Contacto sin nombre". */
  contactName: string;
  /** ISO timestamp del comienzo del appointment. */
  startTime: string | null;
  /** El item crudo, para `leads.notes` o debug. */
  raw: unknown;
}

export interface GhlConversation {
  /** Id de la conversación. */
  id: string;
  rawPhone: string | null;
  contactName: string;
  /** Tipo de canal según GHL — usamos esto para filtrar WhatsApp. */
  type: string | null;
  /** ISO timestamp del último mensaje (útil para acotar al rango del launch). */
  lastMessageDate: string | null;
  raw: unknown;
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
  /** Cuántas conversaciones devolvió GHL en total antes de cualquier filtro. */
  raw_total: number;
  /** Keys top-level del primer item, para verificar shape. */
  sample_conv_keys: string[];
  /** Valores distintos de `type` que vimos (es el canal del contacto). */
  observed_types: string[];
  /** Valores distintos de `lastMessageType` (es el canal del ÚLTIMO mensaje, el que usa GHL para identificar WhatsApp). */
  observed_last_message_types: string[];
  /** Cuántas pasaron el filtro "WhatsApp" (mirando type Y lastMessageType). */
  passed_type_filter: number;
  /** Cuántas pasaron el filtro de ventana de fecha. */
  passed_window_filter: number;
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

  for (const cal of calsResult.rows) {
    const r = await pullFor("calendarId", cal.id, "from_calendars");
    if (!r.ok) return r.failure;
  }
  for (const u of usersResult.rows) {
    const r = await pullFor("userId", u.id, "from_users");
    if (!r.ok) return r.failure;
  }

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

interface GhlUserRef {
  id: string;
  name: string;
}

/**
 * Lista users del location. La API devuelve `{ users: [...] }`. Si el PIT no
 * tiene scope `View Users`, falla con 401/403 → propagamos como token_invalid
 * y el caller (appointments) corta.
 */
async function fetchGhlUsers(
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

/** Pure function — testeable contra fixtures sin mockear fetch. */
export function parseAppointmentsBody(body: unknown): GhlAppointment[] {
  const events = extractArray(body, ["events"]);
  const rows: GhlAppointment[] = [];
  for (const item of events) {
    if (typeof item !== "object" || item === null) continue;
    const evt = item as Record<string, unknown>;
    const id = strOrNull(evt.id);
    if (!id) continue;

    rows.push({
      id,
      rawPhone: extractPhone(evt),
      contactName: extractContactName(evt),
      startTime: strOrNull(evt.startTime),
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
export async function fetchGhlConversations(
  args: FetchArgs,
): Promise<
  | { ok: true; rows: GhlConversation[]; meta: ConversationsMeta }
  | GhlFetchFailure
> {
  const params = new URLSearchParams({
    locationId: args.locationId,
    limit: "100",
    sort: "desc",
    sortBy: "last_message_date",
  });
  const url = `${GHL_API_BASE}/conversations/search?${params.toString()}`;
  const result = await ghlFetch(url, args.token);
  if (!result.ok) return result;

  const sinceMs = dateToEpochStart(args.since);
  const untilMs = dateToEpochEnd(args.until);

  const rawItems = extractArray(result.body, ["conversations"]);
  const meta: ConversationsMeta = {
    raw_total: rawItems.length,
    sample_conv_keys:
      rawItems.length > 0 && typeof rawItems[0] === "object" && rawItems[0]
        ? Object.keys(rawItems[0] as Record<string, unknown>)
        : [],
    observed_types: [],
    observed_last_message_types: [],
    passed_type_filter: 0,
    passed_window_filter: 0,
  };

  // Recolectamos `type` y `lastMessageType` distintos para diagnóstico.
  const typesSet = new Set<string>();
  const lastTypesSet = new Set<string>();
  for (const item of rawItems) {
    if (typeof item !== "object" || item === null) continue;
    const obj = item as Record<string, unknown>;
    if (typeof obj.type === "string") typesSet.add(obj.type);
    if (typeof obj.lastMessageType === "string") {
      lastTypesSet.add(obj.lastMessageType);
    }
  }
  meta.observed_types = Array.from(typesSet);
  meta.observed_last_message_types = Array.from(lastTypesSet);

  const out: GhlConversation[] = [];
  for (const item of rawItems) {
    if (typeof item !== "object" || item === null) continue;
    const conv = item as Record<string, unknown>;
    const id = strOrNull(conv.id);
    if (!id) continue;

    // El canal real de WhatsApp viene en `lastMessageType` (ej.
    // `TYPE_WHATSAPP`). El `type` del contacto es otra cosa
    // (ej. `TYPE_PHONE` = "tiene teléfono como medio de contacto").
    // Aceptamos match en cualquiera de los dos por defensividad.
    const type = strOrNull(conv.type);
    const lastMessageType = strOrNull(conv.lastMessageType);
    if (!isWhatsAppType(type) && !isWhatsAppType(lastMessageType)) continue;
    meta.passed_type_filter++;

    const lastIso = strOrNull(conv.lastMessageDate);
    if (lastIso) {
      const lastMs = Date.parse(lastIso);
      if (Number.isFinite(lastMs) && (lastMs < sinceMs || lastMs > untilMs)) {
        continue;
      }
    }
    meta.passed_window_filter++;

    out.push({
      id,
      rawPhone: extractPhone(conv),
      contactName: extractContactName(conv),
      // Reflejamos el `lastMessageType` cuando exista (es el canal real).
      type: lastMessageType ?? type,
      lastMessageDate: lastIso,
      raw: conv,
    });
  }

  return { ok: true, rows: out, meta };
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
      rawPhone: extractPhone(conv),
      contactName: extractContactName(conv),
      type,
      lastMessageDate: lastIso,
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
    return {
      ok: false,
      kind: "token_invalid",
      message: `GHL respondió ${res.status}`,
      detail: {
        httpStatus: res.status,
        url,
        responseBody: await safeJson(res),
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
