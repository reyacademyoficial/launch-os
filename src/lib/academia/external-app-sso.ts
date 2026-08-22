import "server-only";

import { createHmac } from "node:crypto";

import { getExternalApp, type ExternalAppRow } from "./external-apps";

/**
 * external-app-sso — genera la URL de acceso a una app externa con el usuario
 * ya autenticado. Ver docs/INTEGRATIONS_NITRO_APP.md.
 *
 * DECISIÓN de estrategia por app (auth_strategy en external_apps.config):
 *   - 'jwt':           JWT HS256 firmado con secret shared. Payload:
 *                      { email, courseId, iat, exp (5min por default),
 *                        iss?, aud? }. La app externa valida la firma con
 *                      el mismo secret y sesiona al usuario.
 *   - 'shared_secret': HMAC-SHA256 (email + '.' + ts) firmado con secret.
 *                      URL: ?email=…&ts=…&sig=…&courseId=…
 *   - 'oauth2':        TODO — no implementado hoy. Devuelve error.
 *   - 'magic_link':    llama al endpoint del backend, recibe URL única.
 *
 * ELECCIÓN por defecto para Nitro (agenda-turnos-nitro):
 *   El backend Nitro es Next.js 16 + Supabase (mismo stack que Kingrow) con
 *   auth via Supabase Auth y Server Actions. No expone endpoints REST — el
 *   flujo natural para SSO es:
 *
 *     opción A (recomendada, requiere implementar en Nitro un route handler):
 *       Nitro agrega `GET /api/sso/kingrow?token=<jwt>` que valida el JWT,
 *       resuelve el email → Supabase Auth Admin API para setear la sesión
 *       (createSession o magicLink token), y redirige a la home.
 *       Kingrow usa `auth_strategy = 'jwt'`.
 *
 *     opción B (magic_link):
 *       Nitro expone `POST /api/sso/magic-link` que recibe { email, secret }
 *       y devuelve `{ url: "https://…/auth/callback?…" }`. Kingrow usa
 *       `auth_strategy = 'magic_link'`.
 *
 *   Ambas opciones cubren el caso Nitro. Elegimos 'jwt' como default de la
 *   config inicial porque es más simple (no requiere round-trip). El operador
 *   puede cambiar a 'magic_link' desde el CRUD de apps si prefiere.
 *
 * SECURITY:
 *   - `iat/ts` incluidos en payload/firma para prevenir replay
 *   - `exp` corto (5 min) — el usuario abre la app en cuanto clickea
 *   - secret debe rotar si se filtra; el CRUD lo permite editar
 *   - NO se loguea el secret; solo el appId + strategy en caso de error
 */

export interface SsoUrlOptions {
  /** Segundos de validez. Default 300 (5min). */
  readonly expiresInSeconds?: number;
}

export interface SsoUrlResult {
  readonly url: string;
  readonly strategy: ExternalAppRow["auth_strategy"];
}

/**
 * Genera la URL de SSO a la app externa para el `studentEmail` en el contexto
 * de `courseId`. Lanza si la app no existe, está inactiva o su strategy no
 * está implementada.
 */
export async function generateSsoUrl(
  appId: string,
  studentEmail: string,
  courseId: string,
  options: SsoUrlOptions = {},
): Promise<SsoUrlResult> {
  const app = await getExternalApp(appId);
  if (!app) throw new Error(`external_app ${appId} no existe.`);
  if (!app.active) throw new Error(`external_app ${appId} está inactiva.`);

  const email = studentEmail.trim().toLowerCase();
  if (!email) throw new Error("studentEmail vacío.");

  const cfg = app.config ?? {};
  const expiresInSeconds =
    options.expiresInSeconds ?? cfg.expires_in_seconds ?? 300;

  switch (app.auth_strategy) {
    case "jwt": {
      const url = buildJwtUrl(app, email, courseId, expiresInSeconds);
      return { url, strategy: "jwt" };
    }
    case "shared_secret": {
      const url = buildSharedSecretUrl(app, email, courseId);
      return { url, strategy: "shared_secret" };
    }
    case "magic_link": {
      const url = await requestMagicLink(app, email, courseId);
      return { url, strategy: "magic_link" };
    }
    case "oauth2":
      throw new Error(
        `external_app ${appId} usa auth_strategy='oauth2', no implementado aún. ` +
          `Cambiar a 'jwt' o 'magic_link' desde el CRUD de apps externas.`,
      );
    default: {
      // Exhaustiveness check
      const _exhaustive: never = app.auth_strategy;
      throw new Error(
        `auth_strategy desconocida: ${String(_exhaustive)} para app ${appId}.`,
      );
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// JWT (HS256) — firma manual con Node crypto para evitar dependencia extra
// (jsonwebtoken no está en package.json). Formato estándar RFC 7519.
// ═══════════════════════════════════════════════════════════════════════════

interface JwtPayload {
  readonly email: string;
  readonly courseId: string;
  readonly iat: number;
  readonly exp: number;
  readonly iss?: string;
  readonly aud?: string;
}

function buildJwtUrl(
  app: ExternalAppRow,
  email: string,
  courseId: string,
  expiresInSeconds: number,
): string {
  const secret = app.config?.secret;
  if (!secret || typeof secret !== "string") {
    throw new Error(
      `external_app ${app.id}: config.secret requerido para strategy 'jwt'.`,
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const payload: JwtPayload = {
    email,
    courseId,
    iat: now,
    exp: now + expiresInSeconds,
    ...(app.config?.issuer && { iss: app.config.issuer }),
    ...(app.config?.audience && { aud: app.config.audience }),
  };

  const token = signHs256Jwt(payload, secret);
  return appendToken(app, token);
}

function signHs256Jwt(payload: JwtPayload, secret: string): string {
  const header = { alg: "HS256", typ: "JWT" };
  const enc = (obj: unknown) =>
    base64UrlEncode(Buffer.from(JSON.stringify(obj), "utf8"));
  const signingInput = `${enc(header)}.${enc(payload)}`;
  const sig = base64UrlEncode(
    createHmac("sha256", secret).update(signingInput).digest(),
  );
  return `${signingInput}.${sig}`;
}

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

// ═══════════════════════════════════════════════════════════════════════════
// shared_secret — HMAC(email + '.' + ts) simple; menos overhead que JWT.
// URL: ?email=…&ts=…&sig=…&courseId=…
// La app externa valida recomputando el HMAC con el mismo secret.
// ═══════════════════════════════════════════════════════════════════════════

function buildSharedSecretUrl(
  app: ExternalAppRow,
  email: string,
  courseId: string,
): string {
  const secret = app.config?.secret;
  if (!secret || typeof secret !== "string") {
    throw new Error(
      `external_app ${app.id}: config.secret requerido para strategy 'shared_secret'.`,
    );
  }

  const ts = Math.floor(Date.now() / 1000);
  const payload = `${email}.${ts}`;
  const sig = createHmac("sha256", secret).update(payload).digest("hex");

  const url = new URL(app.base_url);
  url.searchParams.set("email", email);
  url.searchParams.set("ts", String(ts));
  url.searchParams.set("sig", sig);
  url.searchParams.set("courseId", courseId);
  return url.toString();
}

// ═══════════════════════════════════════════════════════════════════════════
// magic_link — round-trip al backend, que devuelve una URL única y de un solo
// uso. El backend valida el shared secret (Authorization header) y responde
// { url }. Timeout 5s.
// ═══════════════════════════════════════════════════════════════════════════

interface MagicLinkResponse {
  readonly url?: string;
  readonly error?: string;
}

async function requestMagicLink(
  app: ExternalAppRow,
  email: string,
  courseId: string,
): Promise<string> {
  const endpoint = app.config?.magic_link_endpoint;
  if (!endpoint || typeof endpoint !== "string") {
    throw new Error(
      `external_app ${app.id}: config.magic_link_endpoint requerido para strategy 'magic_link'.`,
    );
  }
  const secret = app.config?.secret;
  if (!secret || typeof secret !== "string") {
    throw new Error(
      `external_app ${app.id}: config.secret requerido para strategy 'magic_link'.`,
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ email, courseId }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(
        `magic_link endpoint devolvió ${res.status} para app ${app.id}.`,
      );
    }
    const body = (await res.json()) as MagicLinkResponse;
    if (!body.url) {
      throw new Error(
        `magic_link endpoint no devolvió 'url' (app ${app.id}): ${body.error ?? "sin detalle"}.`,
      );
    }
    return body.url;
  } finally {
    clearTimeout(timeout);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Helper común: pegá el token al base_url respetando config.token_placement
// ('query' default | 'hash') y config.token_param ('token' default).
// ═══════════════════════════════════════════════════════════════════════════

function appendToken(app: ExternalAppRow, token: string): string {
  const paramName = app.config?.token_param ?? "token";
  const placement = app.config?.token_placement ?? "query";

  if (placement === "hash") {
    // #token=…  (o #sso=… si se configuró token_param='sso')
    const base = app.base_url;
    const sep = base.includes("#") ? "&" : "#";
    return `${base}${sep}${encodeURIComponent(paramName)}=${encodeURIComponent(token)}`;
  }

  // 'query' → usamos URL para preservar cualquier query previa
  const url = new URL(app.base_url);
  url.searchParams.set(paramName, token);
  return url.toString();
}
