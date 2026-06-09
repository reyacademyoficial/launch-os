import "server-only";

/**
 * Adapter Meta Ads — Graph API v25.
 *
 * Diseño: una sola función pública `fetchMetaInsights` que llama al endpoint
 * de insights y devuelve un array tipado [{date, spend, impressions, clicks,
 * leads, raw}] listo para upsert en `launch_daily_ads`. SIN SDK — usa `fetch`
 * directo para no arrastrar la dependencia ni el ciclo de releases.
 *
 * Lo que NO hace este módulo:
 *  - No toca la DB. Solo llama HTTP y mapea la respuesta.
 *  - No lee secretos del entorno. El token lo recibe por parámetro
 *    (lo lee el orchestrator vía service-role de `launch_secrets`).
 *  - No reintenta. Reintentos van en 3c con backoff + dead-letter.
 *
 * Versionado: v25.0 vigente al 2026-06-09 (verificado contra changelog
 * oficial). Cuando v26 deprecate v25 hay que bumpear la constante.
 */

export const META_API_VERSION = "v25.0";
export const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

/**
 * Status que el adapter puede devolver al orchestrator. Mismo enum que el
 * CHECK de `integration_runs.status` (modulo `success/partial/config_missing/
 * running` que son responsabilidad del orchestrator).
 */
export type MetaSyncErrorKind =
  | "token_invalid"
  | "rate_limited"
  | "error";

export interface MetaInsightDay {
  /** YYYY-MM-DD (date_start del item, asumiendo time_increment=1). */
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  /** El item crudo tal cual Meta lo devuelve — para `launch_daily_ads.raw`. */
  raw: unknown;
}

export interface MetaSyncSuccess {
  ok: true;
  rows: MetaInsightDay[];
}

export interface MetaSyncFailure {
  ok: false;
  kind: MetaSyncErrorKind;
  /** Mensaje crudo de Meta o nuestro propio si el shape no calza. */
  message: string;
  /**
   * Pieza estructurada para guardar en `integration_runs.error_detail`. NO
   * incluye el token (que igual nunca está en la response). Sí incluye
   * `fbtrace_id` cuando lo da Meta — útil para abrir un caso con soporte.
   */
  detail: Record<string, unknown>;
  /**
   * Solo cuando `kind === 'rate_limited'`: segundos sugeridos antes de
   * reintentar (parseado de los headers de uso). null si no se pudo parsear.
   */
  retryAfterSeconds?: number | null;
}

export type MetaSyncResult = MetaSyncSuccess | MetaSyncFailure;

// ─── action_type → leads ────────────────────────────────────────────────────
//
// Heurística estándar para mapear `actions[]` a leads. Esta es la lista del
// brief; el `action_type` exacto depende de cómo esté armada la campaña.
// VALIDAR CON CUENTA REAL antes de cerrar la fase: si el cliente usa otro
// pixel/conversion event, agregar acá.
const LEAD_ACTION_TYPES = new Set<string>([
  "lead",
  "onsite_conversion.lead_grouped",
  "offsite_conversion.fb_pixel_lead",
  "leadgen.other",
]);

/** Exportado solo para tests + para que el orchestrator pueda mostrar en UI cuáles son. */
export function isLeadActionType(actionType: string): boolean {
  return LEAD_ACTION_TYPES.has(actionType);
}

// ─── shape parsing (defensivo) ──────────────────────────────────────────────

interface MetaAction {
  action_type?: unknown;
  value?: unknown;
}

interface MetaInsightItem {
  spend?: unknown;
  impressions?: unknown;
  clicks?: unknown;
  actions?: unknown;
  date_start?: unknown;
  date_stop?: unknown;
  [key: string]: unknown;
}

interface MetaErrorPayload {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  error_user_title?: string;
  error_user_msg?: string;
  fbtrace_id?: string;
  [key: string]: unknown;
}

interface MetaResponseShape {
  data?: unknown;
  error?: MetaErrorPayload;
  paging?: unknown;
}

/**
 * Castea string|number → number, robusto. Meta devuelve la mayoría de los
 * números como string ("12.34"). Si nos llega number directo igual funciona.
 * Si es null/undefined/NaN devuelve 0 (nunca undefined hacia arriba).
 */
function toNumber(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function toInt(v: unknown): number {
  return Math.trunc(toNumber(v));
}

/**
 * Suma los `actions[]` de un item filtrando por `action_type` en
 * LEAD_ACTION_TYPES. Si `actions` no es array (puede no venir en items sin
 * conversiones), devuelve 0.
 */
function sumLeads(actions: unknown): number {
  if (!Array.isArray(actions)) return 0;
  let total = 0;
  for (const a of actions as MetaAction[]) {
    if (typeof a !== "object" || a === null) continue;
    const type = a.action_type;
    if (typeof type !== "string") continue;
    if (!LEAD_ACTION_TYPES.has(type)) continue;
    total += toInt(a.value);
  }
  return total;
}

/**
 * Toma un item del `data[]` de la API y lo convierte en MetaInsightDay.
 * Devuelve null si el item está malformado al punto de no tener `date_start`
 * — en ese caso el orchestrator lo descarta y loguea schema_mismatch.
 */
function mapInsightItem(item: MetaInsightItem): MetaInsightDay | null {
  const date = item.date_start;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return null;
  }
  return {
    date,
    spend: toNumber(item.spend),
    impressions: toInt(item.impressions),
    clicks: toInt(item.clicks),
    leads: sumLeads(item.actions),
    raw: item,
  };
}

// ─── error classification ───────────────────────────────────────────────────

const TOKEN_INVALID_CODES = new Set([190, 102]);
const RATE_LIMIT_CODES = new Set([4, 17, 32, 341]);

/**
 * Clasifica el error de Meta. La doc oficial separa "Login status / authentication"
 * (code 190 con subcodes 460/463/467) de "Rate limiting" (codes 4/17/341).
 * code 32 = page-level rate limit (lo metemos por las dudas).
 */
function classifyMetaError(err: MetaErrorPayload): MetaSyncErrorKind {
  const code = typeof err.code === "number" ? err.code : -1;
  if (TOKEN_INVALID_CODES.has(code)) return "token_invalid";
  if (RATE_LIMIT_CODES.has(code)) return "rate_limited";
  return "error";
}

/**
 * Headers de rate limit de Meta: `X-Business-Use-Case-Usage`,
 * `X-Ad-Account-Usage`, `X-App-Usage`. Vienen como JSON-encoded en el value
 * del header. Cuando hay throttling, el campo `estimated_time_to_regain_access`
 * (en minutos) dice cuánto esperar. Convertimos a segundos.
 */
function parseRetryAfter(headers: Headers): number | null {
  const candidates = [
    "x-business-use-case-usage",
    "x-ad-account-usage",
    "x-app-usage",
  ];
  for (const name of candidates) {
    const raw = headers.get(name);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      const minutes = extractEstimatedRecovery(parsed);
      if (minutes !== null) return minutes * 60;
    } catch {
      // Header no parseable, seguimos al próximo
    }
  }
  return null;
}

function extractEstimatedRecovery(value: unknown): number | null {
  if (value === null || typeof value !== "object") return null;
  // El JSON suele ser { "<account_id>": [ { estimated_time_to_regain_access: N } ] }
  // o un array directo, dependiendo del header. Buscamos cualquier nodo con la key.
  if (Array.isArray(value)) {
    for (const item of value) {
      const m = extractEstimatedRecovery(item);
      if (m !== null) return m;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.estimated_time_to_regain_access === "number") {
    return record.estimated_time_to_regain_access;
  }
  for (const v of Object.values(record)) {
    const m = extractEstimatedRecovery(v);
    if (m !== null) return m;
  }
  return null;
}

// ─── public API ─────────────────────────────────────────────────────────────

export interface FetchMetaInsightsArgs {
  token: string;
  /** "act_1234567890" — con el prefijo `act_`. */
  adAccountId: string;
  /** IDs de las campañas a trackear. El brief exige ≥ 1 — si está vacío, este módulo no se llama. */
  campaignIds: readonly string[];
  /** YYYY-MM-DD inclusive. */
  since: string;
  /** YYYY-MM-DD inclusive. */
  until: string;
}

/**
 * Hace el GET a /v25.0/{adAccountId}/insights filtrando por campañas, con
 * time_increment=1 (un item por día). Devuelve un MetaSyncResult que el
 * orchestrator transforma en filas de `launch_daily_ads` + un registro en
 * `integration_runs`.
 */
export async function fetchMetaInsights(
  args: FetchMetaInsightsArgs,
): Promise<MetaSyncResult> {
  const url = buildInsightsUrl(args);
  let response: Response;
  try {
    response = await fetch(url, { method: "GET" });
  } catch (err) {
    return {
      ok: false,
      kind: "error",
      message:
        err instanceof Error ? err.message : "Network error contacting Meta",
      detail: { cause: "fetch_failed" },
    };
  }

  let body: unknown;
  try {
    body = (await response.json()) as unknown;
  } catch {
    return {
      ok: false,
      kind: "error",
      message: `Respuesta de Meta no es JSON (HTTP ${response.status})`,
      detail: { http_status: response.status, cause: "json_parse_failed" },
    };
  }

  return parseMetaResponse(body, response.headers, response.status);
}

/**
 * Build de la URL — separado para poder testearlo en aislamiento y para que
 * el orchestrator pueda mockear `fetchMetaInsights` por completo si quiere.
 */
function buildInsightsUrl(args: FetchMetaInsightsArgs): string {
  const params = new URLSearchParams({
    fields: "spend,impressions,clicks,actions,date_start,date_stop",
    time_range: JSON.stringify({ since: args.since, until: args.until }),
    time_increment: "1",
    level: "campaign",
    filtering: JSON.stringify([
      {
        field: "campaign.id",
        operator: "IN",
        value: [...args.campaignIds],
      },
    ]),
    access_token: args.token,
    limit: "500",
  });
  return `${META_API_BASE}/${args.adAccountId}/insights?${params.toString()}`;
}

/**
 * Exportada para tests que pasan una respuesta mockeada sin tocar fetch.
 * El orchestrator NO la llama directamente — pasa por `fetchMetaInsights`.
 */
export function parseMetaResponse(
  body: unknown,
  headers: Headers,
  httpStatus: number,
): MetaSyncResult {
  if (body === null || typeof body !== "object") {
    return {
      ok: false,
      kind: "error",
      message: `Respuesta de Meta con shape inválido (HTTP ${httpStatus})`,
      detail: { http_status: httpStatus, cause: "non_object_body" },
    };
  }

  const shape = body as MetaResponseShape;

  // Error explícito de Meta
  if (shape.error && typeof shape.error === "object") {
    const err = shape.error;
    const kind = classifyMetaError(err);
    const result: MetaSyncFailure = {
      ok: false,
      kind,
      message: typeof err.message === "string" ? err.message : "Unknown Meta error",
      detail: {
        code: err.code,
        error_subcode: err.error_subcode,
        type: err.type,
        fbtrace_id: err.fbtrace_id,
        error_user_msg: err.error_user_msg,
        http_status: httpStatus,
      },
    };
    if (kind === "rate_limited") {
      result.retryAfterSeconds = parseRetryAfter(headers);
    }
    return result;
  }

  // HTTP 5xx sin error de Meta — escalamos como error genérico
  if (httpStatus >= 500) {
    return {
      ok: false,
      kind: "error",
      message: `Meta devolvió HTTP ${httpStatus} sin error estructurado`,
      detail: { http_status: httpStatus, cause: "upstream_5xx" },
    };
  }

  // Shape esperado: { data: [...] }
  if (!Array.isArray(shape.data)) {
    return {
      ok: false,
      kind: "error",
      message: "Respuesta de Meta sin `data` array",
      detail: {
        http_status: httpStatus,
        cause: "schema_mismatch",
        body_keys: Object.keys(shape),
      },
    };
  }

  const rows: MetaInsightDay[] = [];
  const skipped: number[] = [];
  for (let i = 0; i < shape.data.length; i++) {
    const item = shape.data[i] as MetaInsightItem;
    const mapped = mapInsightItem(item);
    if (mapped === null) {
      skipped.push(i);
      continue;
    }
    rows.push(mapped);
  }

  if (skipped.length > 0 && rows.length === 0) {
    // Todos los items malformados → reportamos como error de shape, no success vacío
    return {
      ok: false,
      kind: "error",
      message: `Todos los ${shape.data.length} items vinieron sin date_start válido`,
      detail: {
        http_status: httpStatus,
        cause: "schema_mismatch",
        skipped_indexes: skipped,
      },
    };
  }

  return { ok: true, rows };
}
