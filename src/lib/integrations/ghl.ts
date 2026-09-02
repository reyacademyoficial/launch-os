import "server-only";

/**
 * Adapter GoHighLevel — API v2 (services.leadconnectorhq.com).
 *
 * Auth: Private Integration Token (PIT) por header `Authorization: Bearer`.
 * No vence (a diferencia del OAuth de v1 que rotaba). Mismo patrón que el
 * System User token de Meta.
 *
 * Endpoints usados:
 *   - GET /users/?locationId=...
 *     → vendedores del location, para el modal de mapeo.
 *   - GET /opportunities/search?location_id=&pipeline_id=
 *     → oportunidades de la pipeline, agrupadas por `assignedTo` para contar
 *       leads por vendedor.
 *   - POST /contacts/search
 *     → solo el `total` de contacts creados en un día (pageLimit 1), para la
 *       curva de leads nuevos.
 *
 * Versioning del API: GHL exige el header `Version: 2021-04-15` en TODAS las
 * llamadas v2. Si lo omitís devuelve 401 con un error críptico. La constante
 * está abajo y la chequeamos en el test para que no se nos pase.
 *
 * Lo que NO hace este módulo:
 *  - No toca la DB. Solo HTTP + mapeo defensivo de la respuesta.
 *  - No baja contacts ni conversations individuales. Se removió en 2026-09-02
 *    junto con el update de `leads.team_member_id` que era su único consumidor
 *    — era además el grueso del consumo de rate limit.
 */

export const GHL_API_BASE = "https://services.leadconnectorhq.com";
export const GHL_API_VERSION = "2021-04-15";

export type GhlSyncErrorKind = "token_invalid" | "rate_limited" | "error";

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

// ─── Users (para el modal de mapeo de vendedores) ─────────────────────────

// El único consumidor de /users/ es la UI de mapeo de vendedores (server
// action listGhlUserMappings en sync-actions.ts). El sync no lo llama: las
// opportunities de la pipeline ya traen el `assignedTo` que se traduce a
// team_member vía ghl_user_mappings.

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
 * del cap diario. Varios consumidores comparten esa cuota contra la MISMA
 * location: el count de leads por día (1 request por día del launch), la
 * paginación de la pipeline y el sync de tags de Academia, que corre en el
 * mismo cron diario. Sin pacing eso supera el burst en segundos, GHL empieza
 * a devolver 429 en cadena y como `rate_limited` se propaga hacia arriba, el
 * sync entero aborta.
 *
 * Cada PIT corresponde a una location, así que la cuota se administra por
 * token: como mucho MAX_CONCURRENT_REQUESTS en vuelo y RATE_MAX_IN_WINDOW por
 * ventana de 10s. El techo queda debajo del límite real a propósito — los
 * webhooks y otras instancias del deploy comparten la misma cuota.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
 * Ejecuta una llamada HTTP a GHL bajo el throttle de la location y con retry
 * ante 429, para adapters que arman su propio `fetch` en vez de pasar por el
 * cliente interno de este módulo (ghl-tag-sync). Sin esto sus requests no
 * cuentan contra la ventana y desbordan la cuota que comparten con el sync.
 *
 * Devuelve la Response final — que puede seguir siendo 429 si se agotaron los
 * reintentos. El caller decide qué hacer con eso.
 */
export async function ghlRateLimitedFetch(
  token: string,
  fn: () => Promise<Response>,
): Promise<Response> {
  const limiter = limiterFor(token);
  let res = await limiter.run(fn);

  for (let attempt = 0; attempt < MAX_429_RETRIES && res.status === 429; attempt++) {
    const retryAfter = res.headers.get("retry-after");
    const parsed = retryAfter ? parseInt(retryAfter, 10) : NaN;
    const delayMs = backoffDelayMs(attempt, Number.isFinite(parsed) ? parsed : null);
    limiter.penalize(delayMs);
    await sleep(delayMs);
    res = await limiter.run(fn);
  }

  return res;
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
