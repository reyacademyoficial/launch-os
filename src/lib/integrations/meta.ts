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
// Validado contra dump real de Meta (Fase A): `action_type === "lead"` es el
// total consolidado de formularios. Los otros types (`lead_grouped`,
// `fb_pixel_lead`, `onsite_web_lead`, `offsite_complete_registration_add_meta_leads`,
// `offsite_search_add_meta_leads`, `offsite_content_view_add_meta_leads`) son
// el MISMO lead reportado bajo otra surface del píxel — sumarlos = doble cuenta.
// Solo `lead` cuenta.
export const LEAD_ACTION_TYPE = "lead";

/** Exportado solo para tests + para que el orchestrator pueda mostrar en UI cuál es. */
export function isLeadActionType(actionType: string): boolean {
  return actionType === LEAD_ACTION_TYPE;
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
 * Resultado de extraer leads de un `actions[]`. `dup_value_mismatch` se
 * dispara cuando el MISMO `action_type` aparece más de una vez con valores
 * distintos: la dedup asume que los repetidos son idénticos (Meta los
 * duplica dentro de la misma fila); valores divergentes serían un desglose
 * que no entendemos y preferimos frenar a contar mal.
 */
type ActionsParseResult =
  | { ok: true; leads: number }
  | {
      ok: false;
      reason: "dup_value_mismatch";
      action_type: string;
      values: number[];
    };

/**
 * Deduplica `actions[]` por `action_type` y extrae el valor de `lead`.
 *
 * Por qué dedup primero: Meta devuelve el array de acciones repetido dentro
 * de la misma fila (observado en el dump real — cada bloque de acciones
 * viene exactamente dos veces). Sumar = contar cada lead dos veces. La regla
 * es "un único valor por `action_type`"; si dos entradas del mismo type
 * traen valores distintos no es duplicación sino otra cosa → abort.
 */
function parseLeadsFromActions(actions: unknown): ActionsParseResult {
  if (!Array.isArray(actions)) return { ok: true, leads: 0 };

  const byType = new Map<string, number>();
  for (const a of actions as MetaAction[]) {
    if (typeof a !== "object" || a === null) continue;
    const type = a.action_type;
    if (typeof type !== "string") continue;
    const value = toInt(a.value);
    const existing = byType.get(type);
    if (existing === undefined) {
      byType.set(type, value);
      continue;
    }
    if (existing !== value) {
      return {
        ok: false,
        reason: "dup_value_mismatch",
        action_type: type,
        values: [existing, value],
      };
    }
  }

  return { ok: true, leads: byType.get(LEAD_ACTION_TYPE) ?? 0 };
}

type MapItemResult =
  | { ok: true; row: MetaInsightDay }
  | { ok: false; reason: "malformed_date" }
  | {
      ok: false;
      reason: "dup_value_mismatch";
      action_type: string;
      values: number[];
    };

/**
 * Toma un item del `data[]` de la API y lo convierte en MetaInsightDay.
 * Falla con `malformed_date` si no tiene `date_start` válido — el caller lo
 * salta. Falla con `dup_value_mismatch` si la dedup detecta un type repetido
 * con valores distintos — el caller aborta toda la respuesta (es estructural).
 */
function mapInsightItem(item: MetaInsightItem): MapItemResult {
  const date = item.date_start;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, reason: "malformed_date" };
  }
  const leads = parseLeadsFromActions(item.actions);
  if (!leads.ok) {
    return leads;
  }
  return {
    ok: true,
    row: {
      date,
      spend: toNumber(item.spend),
      impressions: toInt(item.impressions),
      clicks: toInt(item.clicks),
      leads: leads.leads,
      raw: item,
    },
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
 * Tope de seguridad para la paginación. Con `time_increment=1` cada página
 * de 500 items cubre ~500 (campañas × días). 50 páginas = ~25k filas, muy
 * por encima de cualquier launch real. Si lo superamos hay un loop o un
 * desglose imprevisto — preferimos abortar con error a colgarnos.
 */
const MAX_PAGES = 50;

/**
 * Extrae `paging.next` (URL absoluta) del body de Meta. Devuelve null si no
 * hay más páginas, si el body no es objeto, o si `next` no es string.
 *
 * La URL devuelta por Meta ya viene con todos los params (incluido
 * `access_token`) → se puede llamar directo con fetch sin re-armarla.
 */
function extractNextPage(body: unknown): string | null {
  if (body === null || typeof body !== "object") return null;
  const paging = (body as MetaResponseShape).paging;
  if (paging === null || typeof paging !== "object") return null;
  const next = (paging as Record<string, unknown>).next;
  return typeof next === "string" && next.length > 0 ? next : null;
}

/**
 * Hace el GET a /v25.0/{adAccountId}/insights filtrando por campañas, con
 * time_increment=1 (un item por día). Sigue `paging.next` hasta agotar —
 * sin esto, launches largos pierden días en silencio (la primera página
 * tiene tope de `limit=500` items). Devuelve un MetaSyncResult que el
 * orchestrator transforma en filas de `launch_daily_ads` + un registro en
 * `integration_runs`.
 */
export async function fetchMetaInsights(
  args: FetchMetaInsightsArgs,
): Promise<MetaSyncResult> {
  const allRows: MetaInsightDay[] = [];
  let nextUrl: string | null = buildInsightsUrl(args);
  let pageCount = 0;

  while (nextUrl !== null) {
    if (pageCount >= MAX_PAGES) {
      return {
        ok: false,
        kind: "error",
        message: `Demasiadas páginas de insights (>${MAX_PAGES}). Loop o desglose imprevisto.`,
        detail: {
          cause: "max_pages_exceeded",
          page_count: pageCount,
        },
      };
    }
    pageCount += 1;

    let response: Response;
    try {
      response = await fetch(nextUrl, { method: "GET" });
    } catch (err) {
      return {
        ok: false,
        kind: "error",
        message:
          err instanceof Error ? err.message : "Network error contacting Meta",
        detail: { cause: "fetch_failed", page: pageCount },
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
        detail: {
          http_status: response.status,
          cause: "json_parse_failed",
          page: pageCount,
        },
      };
    }

    const parsed = parseMetaResponse(body, response.headers, response.status);
    if (!parsed.ok) {
      return parsed;
    }
    allRows.push(...parsed.rows);
    nextUrl = extractNextPage(body);
  }

  return { ok: true, rows: allRows };
}

// ─── TEMP DIAG (Fase C Paso 0) — probe de Lead Ads ──────────────────────────
//
// Antes de codear la feature de leads individuales tenemos que verificar (a)
// si el token actual tiene `leads_retrieval`, y (b) el shape de `field_data`
// — las keys de nombre/teléfono/email dependen de cómo se armó cada form y
// no se pueden mapear a ciegas. El probe corre dentro del sync de Meta y deja
// los raw responses en `integration_runs.error_detail.meta_leadgen_probe`
// para inspeccionar con un SELECT de Studio. Si falla con permission error,
// el detalle nos dice qué scope falta y la feature se posterga hasta el App
// Review. Quitar este bloque entero una vez que Paso 2 esté implementado.
//
// V1 probó `/act_{id}/leadgen_forms` → #100 "nonexisting field". Los forms no
// están en AdAccount; viven en Pages (vía page token) o se descubren a través
// de las ads. V2 (este código) descubre via ads: lista ads de la campaña →
// intenta `/{ad_id}/leads` por las primeras N ads hasta encontrar una con
// data. Eso testea el permiso real (`leads_retrieval`) y captura `field_data`.

const PROBE_MAX_ADS_TO_TRY = 5;

/**
 * Resultado del probe — éxito o error capturados con su shape crudo, no
 * normalizados. La idea es ver EXACTAMENTE lo que Meta devuelve, no nuestra
 * interpretación.
 */
export interface MetaLeadgenProbeResult {
  /** Listing de ads de la primera campaña del launch — confirma acceso basal. */
  ads: {
    ok: boolean;
    httpStatus: number;
    campaignId: string;
    raw: unknown;
  };
  /**
   * Resultado de `/{ad_id}/leads` para hasta `PROBE_MAX_ADS_TO_TRY` ads. Si
   * alguna devolvió leads reales paramos ahí. Si todas devolvieron 200 con
   * data vacía, guardamos la última (= permiso OK, simplemente no hay leads
   * todavía). Si alguna devolvió error de permisos, paramos y guardamos esa.
   */
  sampleLeads: {
    adId: string;
    ok: boolean;
    httpStatus: number;
    raw: unknown;
  } | null;
  /** Cuántas ads probamos antes de cortar (debug). */
  adsTried: number;
}

export async function probeMetaLeadgen(args: {
  token: string;
  campaignIds: readonly string[];
}): Promise<MetaLeadgenProbeResult> {
  const campaignId = args.campaignIds[0] ?? "";
  const result: MetaLeadgenProbeResult = {
    ads: {
      ok: false,
      httpStatus: 0,
      campaignId,
      raw: { cause: "no_campaign_id" },
    },
    sampleLeads: null,
    adsTried: 0,
  };
  if (!campaignId) return result;

  const adsParams = new URLSearchParams({
    fields: "id,name,effective_status",
    limit: "10",
    access_token: args.token,
  });
  const adsUrl = `${META_API_BASE}/${campaignId}/ads?${adsParams.toString()}`;
  const adsRes = await fetchProbe(adsUrl);
  result.ads = {
    ok: adsRes.ok,
    httpStatus: adsRes.httpStatus,
    campaignId,
    raw: adsRes.raw,
  };
  if (!adsRes.ok) return result;

  const adsData = (adsRes.raw as { data?: unknown }).data;
  if (!Array.isArray(adsData) || adsData.length === 0) return result;

  const adIds: string[] = [];
  for (const a of adsData) {
    if (typeof a !== "object" || a === null) continue;
    const id = (a as { id?: unknown }).id;
    if (typeof id === "string" && id.length > 0) adIds.push(id);
  }

  for (let i = 0; i < Math.min(PROBE_MAX_ADS_TO_TRY, adIds.length); i++) {
    const adId = adIds[i]!;
    result.adsTried = i + 1;
    const leadsParams = new URLSearchParams({
      fields:
        "id,created_time,field_data,form_id,ad_id,ad_name,campaign_id,campaign_name,adset_id",
      limit: "3",
      access_token: args.token,
    });
    const leadsUrl = `${META_API_BASE}/${adId}/leads?${leadsParams.toString()}`;
    const leadsRes = await fetchProbe(leadsUrl);
    const snap = {
      adId,
      ok: leadsRes.ok,
      httpStatus: leadsRes.httpStatus,
      raw: leadsRes.raw,
    };
    if (!leadsRes.ok) {
      // Permission/structural error — capturamos y paramos (se va a repetir
      // para todas las ads).
      result.sampleLeads = snap;
      return result;
    }
    const leadsData = (leadsRes.raw as { data?: unknown }).data;
    const hasLeads = Array.isArray(leadsData) && leadsData.length > 0;
    if (hasLeads) {
      // Encontramos data real con field_data — es lo que necesitamos.
      result.sampleLeads = snap;
      return result;
    }
    // ok pero vacía — guardamos como mejor candidato y seguimos buscando una
    // ad con leads. Si todas vienen vacías, queda esta (permiso OK).
    result.sampleLeads = snap;
  }
  return result;
}

/**
 * Fetch defensivo para el probe: nunca tira, captura todo (network errors,
 * non-JSON responses, error envelopes de Meta) y devuelve `ok` solo cuando
 * Meta respondió 2xx + sin `error` envelope.
 */
async function fetchProbe(
  url: string,
): Promise<{ ok: boolean; httpStatus: number; raw: unknown }> {
  let res: Response;
  try {
    res = await fetch(url, { method: "GET" });
  } catch (err) {
    return {
      ok: false,
      httpStatus: 0,
      raw: {
        fetch_error: err instanceof Error ? err.message : String(err),
      },
    };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return {
      ok: false,
      httpStatus: res.status,
      raw: { cause: "non_json_response" },
    };
  }
  const hasError =
    body !== null &&
    typeof body === "object" &&
    (body as Record<string, unknown>).error !== undefined;
  return {
    ok: res.ok && !hasError,
    httpStatus: res.status,
    raw: body,
  };
}

/**
 * Build de la URL — separado para poder testearlo en aislamiento y para que
 * el orchestrator pueda mockear `fetchMetaInsights` por completo si quiere.
 *
 * `action_attribution_windows=["7d_click"]` + `use_unified_attribution_setting=false`:
 * sin esto, Meta usa el default de la cuenta y los `actions[].value` no
 * coinciden con la tabla del Administrador (CPL desfasado). El cliente
 * configura "7 días de clic" en Configuración de atribución; forzamos la
 * misma ventana acá. `use_unified_attribution_setting=false` evita que la
 * configuración unificada del ad set pise nuestra ventana explícita.
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
    action_attribution_windows: JSON.stringify(["7d_click"]),
    use_unified_attribution_setting: "false",
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
    if (!mapped.ok) {
      if (mapped.reason === "dup_value_mismatch") {
        return {
          ok: false,
          kind: "error",
          message: `action_type "${mapped.action_type}" repetido con valores distintos (${mapped.values.join(", ")}). La dedup asume bloques idénticos; valores divergentes sugieren un desglose que no estamos manejando.`,
          detail: {
            http_status: httpStatus,
            cause: "actions_dup_value_mismatch",
            item_index: i,
            action_type: mapped.action_type,
            values: mapped.values,
          },
        };
      }
      skipped.push(i);
      continue;
    }
    rows.push(mapped.row);
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
