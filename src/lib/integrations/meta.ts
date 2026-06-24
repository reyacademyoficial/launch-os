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

// ─── Lead Ads — leads individuales (Fase C Paso 2) ─────────────────────────

/**
 * Un lead individual de un Instant Form de Meta, ya mapeado a campos
 * estándar. Las keys de `field_data` dependen de cómo se armó cada form
 * (verificado con dump real: `email`, `phone_number`, `first_name` +
 * preguntas custom con texto en español como `¿eres_dueño_de_carnicería?`).
 * `mapFieldData` resuelve las variantes conocidas + lo que no encaja queda
 * en `customFields` para no perder info.
 */
export interface MetaLead {
  /** `id` del lead en Meta. Idempotency key del upsert. */
  leadgenId: string;
  /** ISO timestamp de cuando el usuario envió el form. */
  createdTime: string;
  formId: string | null;
  adId: string | null;
  adName: string | null;
  campaignId: string | null;
  /** Mapeo: full_name | first_name [+ last_name] | nombre [+ apellido]. */
  name: string | null;
  /** Mapeo: email | correo | mail. Siempre lowercase + trim. */
  email: string | null;
  /** Mapeo: phone_number | phone | telefono | whatsapp. Crudo, no normalizado. */
  rawPhone: string | null;
  /** Lo que no matcheó las keys conocidas. Key = nombre del campo en Meta. */
  customFields: Record<string, string>;
  /** field_data crudo tal cual vino — para debug si el mapeo se queda corto. */
  raw: unknown;
}

export interface MetaLeadsSuccess {
  ok: true;
  rows: MetaLead[];
  /** Cuántos formularios se barrieron (telemetría del run). */
  formsScanned: number;
  /** True si algún form tocó el tope `LEADS_MAX_PAGES_PER_FORM` y truncó. */
  hitMaxPages: boolean;
}
export type MetaLeadsResult = MetaLeadsSuccess | MetaSyncFailure;

interface FieldDataItem {
  name?: unknown;
  values?: unknown;
}

/**
 * Mapea `field_data` de un lead a los 3 campos estándar (name, email,
 * rawPhone) + un bucket `customFields` para lo que no encaja. Tolera
 * variantes castellanas porque los forms del cliente pueden estar en
 * cualquier idioma. Si no logra mapear name/email/phone, NO descarta el
 * lead — devuelve null en esos campos. El caller upsertea igual.
 */
export function mapFieldData(fieldData: unknown): {
  name: string | null;
  email: string | null;
  rawPhone: string | null;
  customFields: Record<string, string>;
} {
  const empty = { name: null, email: null, rawPhone: null, customFields: {} };
  if (!Array.isArray(fieldData)) return empty;

  let firstName: string | null = null;
  let lastName: string | null = null;
  let fullName: string | null = null;
  let email: string | null = null;
  let rawPhone: string | null = null;
  const customFields: Record<string, string> = {};

  for (const item of fieldData as FieldDataItem[]) {
    if (typeof item !== "object" || item === null) continue;
    const key = typeof item.name === "string" ? item.name : null;
    if (!key) continue;
    const values = Array.isArray(item.values) ? item.values : [];
    const firstValue = values.find(
      (v): v is string => typeof v === "string" && v.length > 0,
    );
    if (firstValue === undefined) continue;

    const k = key.toLowerCase().trim();

    if (matchesEmailKey(k)) {
      email = firstValue.toLowerCase().trim();
    } else if (matchesPhoneKey(k)) {
      rawPhone = firstValue.trim();
    } else if (matchesFullNameKey(k)) {
      fullName = firstValue.trim();
    } else if (matchesFirstNameKey(k)) {
      firstName = firstValue.trim();
    } else if (matchesLastNameKey(k)) {
      lastName = firstValue.trim();
    } else {
      customFields[key] = firstValue;
    }
  }

  const name = fullName ?? joinFullName(firstName, lastName);
  return { name, email, rawPhone, customFields };
}

function matchesEmailKey(k: string): boolean {
  return (
    k === "email" ||
    k === "correo" ||
    k === "mail" ||
    k === "e-mail" ||
    k === "correo_electronico" ||
    k === "correo_electrónico"
  );
}
function matchesPhoneKey(k: string): boolean {
  return (
    k === "phone_number" ||
    k === "phone" ||
    k === "telefono" ||
    k === "teléfono" ||
    k === "whatsapp" ||
    k === "celular" ||
    k === "movil" ||
    k === "móvil"
  );
}
function matchesFullNameKey(k: string): boolean {
  return (
    k === "full_name" ||
    k === "nombre_completo" ||
    k === "nombre_y_apellido" ||
    k === "name"
  );
}
function matchesFirstNameKey(k: string): boolean {
  return k === "first_name" || k === "nombre" || k === "nombres";
}
function matchesLastNameKey(k: string): boolean {
  return k === "last_name" || k === "apellido" || k === "apellidos";
}
function joinFullName(
  first: string | null,
  last: string | null,
): string | null {
  const joined = [first, last].filter(Boolean).join(" ").trim();
  return joined === "" ? null : joined;
}

/**
 * Parsea el body de `/{ad_id}/leads` a `MetaLead[]`. Pura, testeable contra
 * fixtures sin tocar `fetch`. Silencia items malformados (sin `id` o sin
 * `created_time`) en vez de tirar — un lead corrupto no debe abortar el sync.
 */
export function parseLeadsBody(body: unknown): MetaLead[] {
  if (typeof body !== "object" || body === null) return [];
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  const rows: MetaLead[] = [];
  for (const item of data) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : null;
    const createdTime =
      typeof o.created_time === "string" ? o.created_time : null;
    if (!id || !createdTime) continue;
    const mapped = mapFieldData(o.field_data);
    rows.push({
      leadgenId: id,
      createdTime,
      formId: typeof o.form_id === "string" ? o.form_id : null,
      adId: typeof o.ad_id === "string" ? o.ad_id : null,
      adName: typeof o.ad_name === "string" ? o.ad_name : null,
      campaignId: typeof o.campaign_id === "string" ? o.campaign_id : null,
      name: mapped.name,
      email: mapped.email,
      rawPhone: mapped.rawPhone,
      customFields: mapped.customFields,
      raw: item,
    });
  }
  return rows;
}

export interface FetchMetaLeadsArgs {
  token: string;
  /** Mismas campañas que filtra Insights — un launch comparte cuenta con otros. */
  campaignIds: readonly string[];
  /** YYYY-MM-DD inclusive — filtramos client-side por created_time. */
  since: string;
  /** YYYY-MM-DD inclusive. */
  until: string;
}

// Cap: 100 páginas × `limit=200` = 20k leads por form. Subido de 30 → 100
// tras ver runs reales con forms de >6k leads en la ventana del launch (cliente
// mexicano de alto volumen). 100 da headroom para 700 leads/día en un launch
// de un mes sin truncar.
const LEADS_MAX_PAGES_PER_FORM = 100;

/**
 * Trae los leads individuales de las campañas del launch.
 *
 * Strategy form-based (post Fase C iteración rate-limit):
 *  1) `GET /me/accounts?fields=id` → IDs de Pages que el System User ve.
 *  2) Por cada Page: `GET /{page_id}/leadgen_forms?fields=id&limit=100`
 *     siguiendo `paging.next` para descubrir TODOS los forms de esa Page.
 *  3) Por cada form único: `GET /{form_id}/leads?filtering=[time_created>=since]`
 *     con `limit=200`, siguiendo `paging.next` hasta agotar o tocar
 *     `LEADS_MAX_PAGES_PER_FORM`.
 *  4) Filtrar leads por `campaign_id ∈ args.campaignIds` (un form puede
 *     servir a varios launches que compartan cuenta).
 *  5) Filtrar también por `created_time <= until` (server filtra `>= since`).
 *  6) Dedup por `leadgen_id`.
 *
 * Por qué form-based en vez de ad-based: un launch con 7 ads × 30 páginas
 * de leads c/u = 210 calls contra el bucket Marketing API → code 17 rate
 * limit. Iterar por formularios (típicamente 1-5 por launch) baja a ~5-15
 * calls, y el filtro server-side `time_created >= since` corta la
 * paginación a casi nada para launches recientes. Además los endpoints
 * `/{form_id}/leads` cuentan contra el bucket Pages API, distinto del de
 * Marketing → no se acumula con el sync de Insights.
 *
 * El endpoint requiere `leads_retrieval` o `pages_manage_ads` en el token
 * + Page asignada como activo del System User con task `MANAGE_LEADS`. Si
 * falla con permission error, propaga el error tal cual.
 */
export async function fetchMetaLeads(
  args: FetchMetaLeadsArgs,
): Promise<MetaLeadsResult> {
  if (args.campaignIds.length === 0) {
    return { ok: true, rows: [], formsScanned: 0, hitMaxPages: false };
  }

  // 1) Discover Pages via /me/accounts. Pedimos `access_token` también: los
  // endpoints `/{page_id}/leadgen_forms` y `/{form_id}/leads` exigen Page
  // Access Token (Meta error #190 si los llamás con el User token). Los Page
  // Tokens vienen derivados del System User → no vencen mientras el User
  // token esté vivo.
  const pagesRes = await fetchAndParseJson(buildMyAccountsUrl(args.token));
  if (!pagesRes.ok) return pagesRes;
  const pages = extractPages(pagesRes.body);
  if (pages.length === 0) {
    return { ok: true, rows: [], formsScanned: 0, hitMaxPages: false };
  }

  const sinceMs = Date.parse(`${args.since}T00:00:00.000Z`);
  const untilMs = Date.parse(`${args.until}T23:59:59.999Z`);
  const sinceUnix = Math.floor(sinceMs / 1000);
  const campaignIdSet = new Set(args.campaignIds);
  const byLeadgenId = new Map<string, MetaLead>();
  const seenFormIds = new Set<string>();
  let hitMaxPages = false;

  // 2-3) Por cada Page → discover forms (con SU Page Token) → leads de cada
  // form (con el mismo Page Token). Mantenemos el token en scope porque el
  // form "pertenece" a la Page que lo creó.
  for (const page of pages) {
    const formIdsThisPage: string[] = [];
    let formsUrl: string | null = buildLeadgenFormsUrl(
      page.id,
      page.accessToken,
    );
    while (formsUrl !== null) {
      const formsRes = await fetchAndParseJson(formsUrl);
      if (!formsRes.ok) return formsRes;
      for (const id of extractFormIds(formsRes.body)) {
        if (!seenFormIds.has(id)) {
          seenFormIds.add(id);
          formIdsThisPage.push(id);
        }
      }
      formsUrl = extractNextPage(formsRes.body);
    }

    for (const formId of formIdsThisPage) {
      let nextUrl: string | null = buildFormLeadsUrl(
        formId,
        page.accessToken,
        sinceUnix,
      );
      let pg = 0;
      while (nextUrl !== null) {
        if (pg >= LEADS_MAX_PAGES_PER_FORM) {
          hitMaxPages = true;
          break;
        }
        pg++;
        const pageRes = await fetchAndParseJson(nextUrl);
        if (!pageRes.ok) return pageRes;
        const leads = parseLeadsBody(pageRes.body);
        for (const lead of leads) {
          // Filtro de campaña: el form puede servir leads de otros launches
          // en la misma cuenta. Si no sabemos a qué campaña pertenece,
          // descartamos por seguridad (no atribuir a este launch sin
          // evidencia).
          if (!lead.campaignId || !campaignIdSet.has(lead.campaignId)) continue;
          const t = Date.parse(lead.createdTime);
          if (!Number.isFinite(t)) continue;
          // since ya filtrado server-side; verificamos until client-side.
          if (t > untilMs) continue;
          if (byLeadgenId.has(lead.leadgenId)) continue;
          byLeadgenId.set(lead.leadgenId, lead);
        }
        nextUrl = extractNextPage(pageRes.body);
      }
    }
  }

  return {
    ok: true,
    rows: Array.from(byLeadgenId.values()),
    formsScanned: seenFormIds.size,
    hitMaxPages,
  };
}

function buildMyAccountsUrl(token: string): string {
  const p = new URLSearchParams({
    // Meta devuelve un Page Access Token derivado del System User en
    // `access_token` cuando lo pedís explícito. Sin este field, no viene.
    fields: "id,access_token",
    limit: "100",
    access_token: token,
  });
  return `${META_API_BASE}/me/accounts?${p.toString()}`;
}

function buildLeadgenFormsUrl(pageId: string, token: string): string {
  const p = new URLSearchParams({
    fields: "id,name,status",
    limit: "100",
    access_token: token,
  });
  return `${META_API_BASE}/${pageId}/leadgen_forms?${p.toString()}`;
}

function buildFormLeadsUrl(
  formId: string,
  token: string,
  sinceUnix: number,
): string {
  const p = new URLSearchParams({
    fields:
      "id,created_time,field_data,form_id,ad_id,ad_name,campaign_id,campaign_name,adset_id",
    limit: "200",
    filtering: JSON.stringify([
      {
        field: "time_created",
        operator: "GREATER_THAN_OR_EQUAL",
        value: sinceUnix,
      },
    ]),
    access_token: token,
  });
  return `${META_API_BASE}/${formId}/leads?${p.toString()}`;
}

interface PageRef {
  id: string;
  accessToken: string;
}

function extractPages(body: unknown): PageRef[] {
  if (typeof body !== "object" || body === null) return [];
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  const out: PageRef[] = [];
  for (const p of data) {
    if (typeof p !== "object" || p === null) continue;
    const id = (p as { id?: unknown }).id;
    const accessToken = (p as { access_token?: unknown }).access_token;
    if (
      typeof id === "string" &&
      id.length > 0 &&
      typeof accessToken === "string" &&
      accessToken.length > 0
    ) {
      out.push({ id, accessToken });
    }
  }
  return out;
}

function extractFormIds(body: unknown): string[] {
  if (typeof body !== "object" || body === null) return [];
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  const out: string[] = [];
  for (const f of data) {
    if (typeof f !== "object" || f === null) continue;
    const id = (f as { id?: unknown }).id;
    if (typeof id === "string" && id.length > 0) out.push(id);
  }
  return out;
}

/**
 * Helper común: fetch + JSON parse + clasificación de error de Meta. Mismo
 * shape de salida que `parseMetaResponse` pero pensado para endpoints que
 * NO devuelven `data: MetaInsightItem[]` — solo necesitamos saber si OK
 * (devolver el body crudo para que el caller lo procese) o si falló
 * (devolver `MetaSyncFailure` para propagar).
 */
async function fetchAndParseJson(
  url: string,
): Promise<{ ok: true; body: unknown } | MetaSyncFailure> {
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
    body = await response.json();
  } catch {
    return {
      ok: false,
      kind: "error",
      message: `Respuesta de Meta no es JSON (HTTP ${response.status})`,
      detail: { http_status: response.status, cause: "json_parse_failed" },
    };
  }
  if (body && typeof body === "object") {
    const err = (body as { error?: MetaErrorPayload }).error;
    if (err && typeof err === "object") {
      const kind = classifyMetaError(err);
      const result: MetaSyncFailure = {
        ok: false,
        kind,
        message:
          typeof err.message === "string" ? err.message : "Unknown Meta error",
        detail: {
          code: err.code,
          error_subcode: err.error_subcode,
          type: err.type,
          fbtrace_id: err.fbtrace_id,
          error_user_msg: err.error_user_msg,
          http_status: response.status,
        },
      };
      if (kind === "rate_limited") {
        result.retryAfterSeconds = parseRetryAfter(response.headers);
      }
      return result;
    }
  }
  if (response.status >= 500) {
    return {
      ok: false,
      kind: "error",
      message: `Meta devolvió HTTP ${response.status} sin error estructurado`,
      detail: { http_status: response.status, cause: "upstream_5xx" },
    };
  }
  return { ok: true, body };
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
