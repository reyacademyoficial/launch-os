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

interface FetchArgs {
  token: string;
  locationId: string;
  since: string; // YYYY-MM-DD
  until: string; // YYYY-MM-DD
}

// ─── Appointments ──────────────────────────────────────────────────────────

/**
 * Trae appointments del calendar entre `since` y `until` (inclusive).
 * GHL espera epoch millis en startTime/endTime — convertimos las date-only
 * strings que vienen del launch (date_start/date_end).
 */
export async function fetchGhlAppointments(
  args: FetchArgs,
): Promise<GhlFetchResult<GhlAppointment>> {
  const startMs = dateToEpochStart(args.since);
  const endMs = dateToEpochEnd(args.until);
  const params = new URLSearchParams({
    locationId: args.locationId,
    startTime: String(startMs),
    endTime: String(endMs),
  });
  const url = `${GHL_API_BASE}/calendars/events?${params.toString()}`;

  const result = await ghlFetch(url, args.token);
  if (!result.ok) return result;
  return { ok: true, rows: parseAppointmentsBody(result.body) };
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
): Promise<GhlFetchResult<GhlConversation>> {
  const url = `${GHL_API_BASE}/conversations/search`;
  const result = await ghlFetch(url, args.token, {
    method: "POST",
    body: JSON.stringify({
      locationId: args.locationId,
      // GHL acepta sort por dateUpdated desc y limit hasta 100. Para 3b
      // pedimos los 100 más recientes; cuando el caso aparezca con más,
      // sumamos paginación (esto es 3b, no 3c).
      limit: 100,
      sort: "desc",
      sortBy: "last_message_date",
    }),
  });
  if (!result.ok) return result;
  const sinceMs = dateToEpochStart(args.since);
  const untilMs = dateToEpochEnd(args.until);
  return {
    ok: true,
    rows: parseConversationsBody(result.body, sinceMs, untilMs),
  };
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

  // 401 = token inválido / sin permiso. GHL devuelve message tipo "Invalid JWT"
  // o "Unauthorized". No discriminamos subcausas — todo 401 va a token_invalid.
  if (res.status === 401 || res.status === 403) {
    return {
      ok: false,
      kind: "token_invalid",
      message: `GHL respondió ${res.status}`,
      detail: await safeJson(res),
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
      detail: await safeJson(res),
      retryAfterSeconds: Number.isFinite(retryAfterSeconds ?? NaN)
        ? retryAfterSeconds
        : null,
    };
  }

  if (res.status >= 500) {
    return {
      ok: false,
      kind: "error",
      message: `GHL respondió ${res.status}`,
      detail: await safeJson(res),
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      kind: "error",
      message: `GHL respondió ${res.status}`,
      detail: await safeJson(res),
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
