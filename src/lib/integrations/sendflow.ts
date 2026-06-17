import "server-only";

/**
 * Adapter SendFlow — SendAPI (https://sendflow.pro/sendapi).
 *
 * Diseño: dos funciones públicas, ambas read-only:
 *   - `fetchSendflowReleases`  → lista las comunidades del usuario (id+name)
 *                                 para que la UI muestre el multi-select.
 *   - `fetchSendflowAnalytics` → trae add/remove/clicks de una release,
 *                                 acotado a la ventana [windowStart, windowEnd]
 *                                 usando el desglose por día (`dates`).
 *
 * Lo que NO hace este módulo:
 *  - No toca la DB. Solo HTTP + parse.
 *  - No lee secretos del entorno. El token (API Key) lo recibe por parámetro.
 *  - No reintenta. Reintentos van en 3c con backoff.
 *  - No SUMA entre releases — eso lo hace el orchestrator (un launch puede
 *    tener N releases; el orchestrator itera y suma).
 *
 * ⚠️ Formato de fecha (validar con dato real — ver TASK probe):
 *   Las claves de `dates` son strings tipo "10072025". El default es
 *   DDMMYYYY (LATAM); confirmar con un fetch real antes de cerrar la fase.
 *   Si la convención de SendFlow fuera MMDDYYYY, el filtrado por ventana
 *   sumaría días equivocados sin dar error.
 */

export const SENDFLOW_API_BASE = "https://sendflow.pro/sendapi";

/**
 * Default del formato de claves de `dates`. Hardcodeado acá para tener un
 * único punto de cambio. Test asociado en `sendflow.test.ts` fija una key
 * conocida y se rompe si alguien lo invierte sin actualizar el test.
 */
export const SENDFLOW_DATE_FORMAT_DEFAULT: SendflowDateFormat = "DDMMYYYY";

export type SendflowDateFormat = "DDMMYYYY" | "MMDDYYYY";

// ─── error classification ───────────────────────────────────────────────────

/**
 * Mismo enum que el CHECK de `integration_runs.status` (modulo
 * success/partial/config_missing/running que son responsabilidad del
 * orchestrator). SendFlow no documenta rate-limits explícitos — si aparecen
 * en producción los clasificamos en 3c. Por ahora 429 = error genérico.
 */
export type SendflowSyncErrorKind = "token_invalid" | "error";

export interface SendflowSyncFailure {
  ok: false;
  kind: SendflowSyncErrorKind;
  message: string;
  /** Pieza estructurada para guardar en `integration_runs.error_detail`. */
  detail: Record<string, unknown>;
}

// ─── parser de fechas ───────────────────────────────────────────────────────

/**
 * Convierte una key tipo "10072025" en "YYYY-MM-DD" según el formato dado.
 * Devuelve null si la key no tiene 8 dígitos o si DD/MM no son valores
 * válidos (lo segundo importa para detectar errores de formato: una key
 * "13072025" parseada como MMDDYYYY daría mes=13 y debería rechazarse).
 *
 * Exportada para test directo — el orchestrator no la llama, va vía
 * `fetchSendflowAnalytics`.
 */
export function parseSendflowDateKey(
  key: string,
  format: SendflowDateFormat,
): string | null {
  if (typeof key !== "string" || !/^\d{8}$/.test(key)) return null;

  let dd: number;
  let mm: number;
  let yyyy: number;
  if (format === "DDMMYYYY") {
    dd = parseInt(key.slice(0, 2), 10);
    mm = parseInt(key.slice(2, 4), 10);
    yyyy = parseInt(key.slice(4, 8), 10);
  } else {
    mm = parseInt(key.slice(0, 2), 10);
    dd = parseInt(key.slice(2, 4), 10);
    yyyy = parseInt(key.slice(4, 8), 10);
  }
  if (mm < 1 || mm > 12) return null;
  if (dd < 1 || dd > 31) return null;
  if (yyyy < 2000 || yyyy > 2100) return null;

  const ddStr = dd.toString().padStart(2, "0");
  const mmStr = mm.toString().padStart(2, "0");
  return `${yyyy}-${mmStr}-${ddStr}`;
}

// ─── /releases ──────────────────────────────────────────────────────────────

export interface SendflowRelease {
  releaseId: string;
  name: string;
}

export interface FetchSendflowReleasesArgs {
  token: string;
}

export type FetchSendflowReleasesResult =
  | { ok: true; releases: SendflowRelease[] }
  | SendflowSyncFailure;

/**
 * GET /releases — lista las comunidades del usuario para poblar el
 * multi-select en la pantalla de configuración. Defensivo con el shape:
 * la API documenta `{id, name}` pero acepta variantes (`release_id`).
 */
export async function fetchSendflowReleases(
  args: FetchSendflowReleasesArgs,
): Promise<FetchSendflowReleasesResult> {
  const url = `${SENDFLOW_API_BASE}/releases`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${args.token}`,
        Accept: "application/json",
      },
    });
  } catch (err) {
    return {
      ok: false,
      kind: "error",
      message:
        err instanceof Error
          ? err.message
          : "Network error contacting SendFlow",
      detail: { cause: "fetch_failed" },
    };
  }

  if (response.status === 401) {
    return {
      ok: false,
      kind: "token_invalid",
      message: "API Key de SendFlow rechazada (401)",
      detail: { http_status: 401, cause: "auth_failed" },
    };
  }

  let body: unknown;
  try {
    body = (await response.json()) as unknown;
  } catch {
    return {
      ok: false,
      kind: "error",
      message: `Respuesta de SendFlow no es JSON (HTTP ${response.status})`,
      detail: { http_status: response.status, cause: "json_parse_failed" },
    };
  }

  if (response.status >= 500) {
    return {
      ok: false,
      kind: "error",
      message: `SendFlow devolvió HTTP ${response.status}`,
      detail: { http_status: response.status, cause: "upstream_5xx" },
    };
  }
  if (response.status >= 400) {
    return {
      ok: false,
      kind: "error",
      message: `SendFlow devolvió HTTP ${response.status}`,
      detail: { http_status: response.status, cause: "client_error", body },
    };
  }

  return parseReleasesBody(body, response.status);
}

/**
 * Exportada para tests con body mockeado. Acepta dos shapes posibles:
 *   1) array directo: `[{id, name}, ...]`
 *   2) envuelto: `{ releases: [...] }` o `{ data: [...] }`
 * Y dos nombres para el id: `id` o `release_id`.
 */
export function parseReleasesBody(
  body: unknown,
  httpStatus: number,
): FetchSendflowReleasesResult {
  let items: unknown[];
  if (Array.isArray(body)) {
    items = body;
  } else if (body !== null && typeof body === "object") {
    const rec = body as Record<string, unknown>;
    if (Array.isArray(rec.releases)) items = rec.releases;
    else if (Array.isArray(rec.data)) items = rec.data;
    else {
      return {
        ok: false,
        kind: "error",
        message: "Respuesta de SendFlow /releases sin array",
        detail: {
          http_status: httpStatus,
          cause: "schema_mismatch",
          body_keys: Object.keys(rec),
        },
      };
    }
  } else {
    return {
      ok: false,
      kind: "error",
      message: "Respuesta de SendFlow /releases con shape inválido",
      detail: { http_status: httpStatus, cause: "non_object_body" },
    };
  }

  const releases: SendflowRelease[] = [];
  for (const item of items) {
    if (item === null || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const id =
      typeof rec.id === "string"
        ? rec.id
        : typeof rec.release_id === "string"
          ? rec.release_id
          : null;
    if (!id) continue;
    const name = typeof rec.name === "string" ? rec.name : id;
    releases.push({ releaseId: id, name });
  }

  return { ok: true, releases };
}

// ─── /releases/{id}/analytics ───────────────────────────────────────────────

export interface SendflowAnalyticsWindowedDay {
  /** YYYY-MM-DD. */
  date: string;
  entered: number;
  removed: number;
  clicks: number;
}

export interface SendflowAnalyticsSuccess {
  ok: true;
  releaseId: string;
  /** Sumatoria de `add.dates[d]` para d ∈ [windowStart, windowEnd]. */
  entered: number;
  /** Sumatoria de `remove.dates[d]`. */
  removed: number;
  /** Sumatoria de `clicks.dates[d]`. */
  clicks: number;
  /** Días que cayeron dentro de la ventana, ya parseados — para `raw` y debug. */
  windowedDays: SendflowAnalyticsWindowedDay[];
  /**
   * Keys crudas de `add.dates` tal cual las devolvió SendFlow (sin parsear,
   * sin filtrar por ventana). Se guardan en `raw` para auditar el formato
   * y validar el probe DDMMYYYY vs MMDDYYYY contra un día conocido.
   */
  rawAddDateKeys: Record<string, number>;
}

export type SendflowAnalyticsResult =
  | SendflowAnalyticsSuccess
  | SendflowSyncFailure;

export interface FetchSendflowAnalyticsArgs {
  token: string;
  releaseId: string;
  /** YYYY-MM-DD inclusive. */
  windowStart: string;
  /** YYYY-MM-DD inclusive. */
  windowEnd: string;
  /** Default a `SENDFLOW_DATE_FORMAT_DEFAULT`. Override para tests/probe. */
  dateFormat?: SendflowDateFormat;
}

/**
 * GET /releases/{releaseId}/analytics — devuelve {add, remove, clicks} con
 * `total` y `dates`. Nosotros ignoramos `total` y sumamos a mano desde
 * `dates` filtrado a la ventana del lanzamiento (default del brief).
 */
export async function fetchSendflowAnalytics(
  args: FetchSendflowAnalyticsArgs,
): Promise<SendflowAnalyticsResult> {
  const url = `${SENDFLOW_API_BASE}/releases/${encodeURIComponent(args.releaseId)}/analytics`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${args.token}`,
        Accept: "application/json",
      },
    });
  } catch (err) {
    return {
      ok: false,
      kind: "error",
      message:
        err instanceof Error
          ? err.message
          : "Network error contacting SendFlow",
      detail: { cause: "fetch_failed", release_id: args.releaseId },
    };
  }

  if (response.status === 401 || response.status === 403) {
    // Leemos el body como TEXT (puede ser HTML, JSON o vacío) para guardar
    // el mensaje literal de SendFlow en error_detail. Útil para diagnosticar
    // 403 confusos donde la key es válida pero el server rechaza igual.
    const upstreamBody = await safeReadText(response);

    if (response.status === 401) {
      return {
        ok: false,
        kind: "token_invalid",
        message: "API Key de SendFlow rechazada (401)",
        detail: {
          http_status: 401,
          cause: "auth_failed",
          release_id: args.releaseId,
          upstream_body: upstreamBody,
        },
      };
    }
    return {
      ok: false,
      kind: "error",
      message: `SendFlow rechazó el release ${args.releaseId} con 403. Body upstream guardado en error_detail.upstream_body.`,
      detail: {
        http_status: 403,
        cause: "release_forbidden",
        release_id: args.releaseId,
        upstream_body: upstreamBody,
      },
    };
  }

  let body: unknown;
  try {
    body = (await response.json()) as unknown;
  } catch {
    return {
      ok: false,
      kind: "error",
      message: `Respuesta de SendFlow no es JSON (HTTP ${response.status})`,
      detail: {
        http_status: response.status,
        cause: "json_parse_failed",
        release_id: args.releaseId,
      },
    };
  }

  if (response.status >= 500) {
    return {
      ok: false,
      kind: "error",
      message: `SendFlow devolvió HTTP ${response.status}`,
      detail: {
        http_status: response.status,
        cause: "upstream_5xx",
        release_id: args.releaseId,
      },
    };
  }
  if (response.status === 404) {
    return {
      ok: false,
      kind: "error",
      message: `Release ${args.releaseId} no existe en SendFlow`,
      detail: {
        http_status: 404,
        cause: "release_not_found",
        release_id: args.releaseId,
      },
    };
  }
  if (response.status >= 400) {
    return {
      ok: false,
      kind: "error",
      message: `SendFlow devolvió HTTP ${response.status}`,
      detail: {
        http_status: response.status,
        cause: "client_error",
        release_id: args.releaseId,
        body,
      },
    };
  }

  return parseAnalyticsBody(body, {
    releaseId: args.releaseId,
    windowStart: args.windowStart,
    windowEnd: args.windowEnd,
    dateFormat: args.dateFormat ?? SENDFLOW_DATE_FORMAT_DEFAULT,
    httpStatus: response.status,
  });
}

/**
 * Exportada para tests con body mockeado. El orchestrator no la llama —
 * pasa por `fetchSendflowAnalytics`.
 *
 * Acepta el shape verificado:
 *   { add: { dates: {...}, total }, remove: { dates: {...}, total },
 *     clicks: { dates: {...}, total } }
 *
 * Defensivo: si alguna de las 3 ramas falta o `dates` no es objeto, la
 * tratamos como vacía (0 entered/removed/clicks de esa rama) — no fallamos
 * el sync entero, salvo que el body completo no sea un objeto.
 */
export function parseAnalyticsBody(
  body: unknown,
  ctx: {
    releaseId: string;
    windowStart: string;
    windowEnd: string;
    dateFormat: SendflowDateFormat;
    httpStatus: number;
  },
): SendflowAnalyticsResult {
  if (body === null || typeof body !== "object") {
    return {
      ok: false,
      kind: "error",
      message: `Respuesta de SendFlow con shape inválido (HTTP ${ctx.httpStatus})`,
      detail: {
        http_status: ctx.httpStatus,
        cause: "non_object_body",
        release_id: ctx.releaseId,
      },
    };
  }
  const shape = body as Record<string, unknown>;

  const addDates = extractDates(shape.add);
  const removeDates = extractDates(shape.remove);
  const clicksDates = extractDates(shape.clicks);

  // Acumulador por fecha (YYYY-MM-DD) — uno solo por las 3 ramas para no
  // recorrer la ventana 3 veces. Días con cualquiera de las 3 > 0 cuentan.
  const byDate = new Map<
    string,
    { entered: number; removed: number; clicks: number }
  >();

  const accumulate = (
    branch: Record<string, unknown>,
    field: "entered" | "removed" | "clicks",
  ) => {
    for (const [key, value] of Object.entries(branch)) {
      const date = parseSendflowDateKey(key, ctx.dateFormat);
      if (date === null) continue;
      if (date < ctx.windowStart || date > ctx.windowEnd) continue;
      const n = toInt(value);
      const existing = byDate.get(date);
      if (existing) {
        existing[field] += n;
      } else {
        const fresh = { entered: 0, removed: 0, clicks: 0 };
        fresh[field] = n;
        byDate.set(date, fresh);
      }
    }
  };

  accumulate(addDates, "entered");
  accumulate(removeDates, "removed");
  accumulate(clicksDates, "clicks");

  const windowedDays: SendflowAnalyticsWindowedDay[] = Array.from(
    byDate.entries(),
  )
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date));

  let entered = 0;
  let removed = 0;
  let clicks = 0;
  for (const d of windowedDays) {
    entered += d.entered;
    removed += d.removed;
    clicks += d.clicks;
  }

  // Si NINGUNA de las 3 ramas trajo `dates`, lo más probable es shape roto
  // (no que la release esté vacía — vacía traería `dates: {}` legítimo).
  if (
    Object.keys(addDates).length === 0 &&
    Object.keys(removeDates).length === 0 &&
    Object.keys(clicksDates).length === 0 &&
    !hasAnyBranch(shape)
  ) {
    return {
      ok: false,
      kind: "error",
      message: "Respuesta de SendFlow sin ramas add/remove/clicks",
      detail: {
        http_status: ctx.httpStatus,
        cause: "schema_mismatch",
        body_keys: Object.keys(shape),
        release_id: ctx.releaseId,
      },
    };
  }

  // Snapshot crudo de add.dates: keys + valores tal cual SendFlow las devolvió.
  // Sirve para auditar el formato real (DDMMYYYY vs MMDDYYYY) — comparando
  // contra un día conocido del lanzamiento se cierra el probe sin curl.
  const rawAddDateKeys: Record<string, number> = {};
  for (const [key, value] of Object.entries(addDates)) {
    rawAddDateKeys[key] = toInt(value);
  }

  return {
    ok: true,
    releaseId: ctx.releaseId,
    entered,
    removed,
    clicks,
    windowedDays,
    rawAddDateKeys,
  };
}

/**
 * Extrae el sub-objeto `dates` de una rama (add/remove/clicks). Si no es
 * un objeto, devuelve {} para que el caller no tenga que branchear.
 */
function extractDates(branch: unknown): Record<string, unknown> {
  if (branch === null || typeof branch !== "object") return {};
  const rec = branch as Record<string, unknown>;
  if (rec.dates === null || typeof rec.dates !== "object") return {};
  return rec.dates as Record<string, unknown>;
}

function hasAnyBranch(shape: Record<string, unknown>): boolean {
  return (
    (shape.add !== undefined && shape.add !== null) ||
    (shape.remove !== undefined && shape.remove !== null) ||
    (shape.clicks !== undefined && shape.clicks !== null)
  );
}

/**
 * Lee el body como text sin propagar excepciones. Si el server no devolvió
 * body, devuelve string vacío. Se trunca a 2KB para no inflar error_detail
 * con respuestas HTML grandes (página de error completa de un proxy/CDN).
 */
async function safeReadText(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.length > 2048 ? text.slice(0, 2048) + "…[truncated]" : text;
  } catch {
    return "";
  }
}

function toInt(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? Math.trunc(v) : 0;
  if (typeof v === "string") {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}
