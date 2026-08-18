import "server-only";

/**
 * Cliente mínimo de la API de Notion (v1). Solo los endpoints que necesita
 * el sync one-way Notion → `internal_projects`. Sin SDK — fetch directo con
 * cabeceras + throttling. El SDK oficial de Notion no aporta mucho para 4
 * endpoints y tiene footprint grande.
 *
 * VERSIÓN Y CABECERAS
 *   Notion pide `Notion-Version` explícita en cada request. Fija en
 *   `NOTION_API_VERSION` — bumpearla puntualmente cuando la API cambie shape.
 *
 * RATE LIMITING
 *   Notion documenta 3 req/s por integration (average). No lo enforzamos
 *   con delays — si un sync grande se acerca al límite, la API devuelve
 *   429 con `Retry-After`. El caller puede reintentar. Para 4a no hace
 *   falta (config UI hace 1-2 reqs por acción).
 *
 * ERRORES
 *   Cualquier respuesta con `!res.ok` levanta `NotionApiError` con el
 *   status HTTP + el `message` del body. El caller lo captura y decide qué
 *   hacer (marcar workspace como inválido si 401, log y continuar si 429,
 *   etc.).
 */

const NOTION_API_BASE = "https://api.notion.com/v1";
const NOTION_API_VERSION = "2022-06-28";

export class NotionApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
    this.name = "NotionApiError";
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Shapes públicos (subset de lo que devuelve Notion — solo lo que usamos)
// ═══════════════════════════════════════════════════════════════════════════

export interface NotionBotInfo {
  /** ID del bot user asociado al integration token. */
  readonly bot_id: string;
  /** Nombre del workspace al que pertenece la integration. */
  readonly workspace_name: string | null;
}

export interface NotionDatabase {
  readonly id: string;
  readonly title_plain: string;
  readonly last_edited_time: string;
}

export interface NotionUser {
  readonly id: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly avatar_url: string | null;
  readonly type: "person" | "bot";
}

export interface NotionPage {
  readonly id: string;
  readonly url: string;
  readonly last_edited_time: string;
  readonly created_time: string;
  /**
   * Propiedades tal cual las devuelve Notion (raw). El caller resuelve el
   * mapping a KG usando `property_map` de `notion_databases`. Guardamos el
   * shape completo para que el mapper decida cómo interpretar cada tipo.
   */
  readonly properties: Record<string, unknown>;
}

export interface NotionPageComment {
  readonly id: string;
  /** Autor del comentario (notion user id). null si Notion no lo expone. */
  readonly notion_user_id: string | null;
  /**
   * Contenido plano — el rich_text de Notion aplanado con `plain_text` de
   * cada segmento. Suficiente para v1 (display readonly). Mentions llegan
   * como texto sin resolver (Notion ya inyecta el "@Nombre" en plain_text).
   */
  readonly content_plain: string;
  readonly created_time: string;
  readonly last_edited_time: string;
}

/**
 * Schema-ish de una database — solo las propiedades con tipo. Se usa en
 * la UI de config de mapping para poblar los dropdowns "elegí la columna
 * que representa el status/priority/...".
 */
export interface NotionDatabaseSchema {
  readonly id: string;
  readonly title_plain: string;
  readonly properties: ReadonlyArray<{
    readonly name: string;
    readonly type: string;
    /** Solo definido para type='select' / 'multi_select' / 'status'. */
    readonly options: ReadonlyArray<{ readonly name: string }>;
  }>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Endpoints
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /v1/users/me — devuelve el bot user del integration. Sirve para
 * validar el token (401 = inválido) y para extraer el workspace_name.
 */
export async function whoAmI(token: string): Promise<NotionBotInfo> {
  const res = await notionFetch(token, "GET", "/users/me");
  const data = res as {
    id: string;
    type: string;
    bot?: { workspace_name?: string | null };
  };
  return {
    bot_id: data.id,
    workspace_name: data.bot?.workspace_name ?? null,
  };
}

/**
 * POST /v1/search con filter type=database — lista las databases a las que
 * la integration tiene acceso. Paginado con cursor.
 */
export async function listDatabases(token: string): Promise<NotionDatabase[]> {
  const out: NotionDatabase[] = [];
  let cursor: string | undefined = undefined;
  do {
    const body: Record<string, unknown> = {
      filter: { property: "object", value: "database" },
      page_size: 100,
    };
    if (cursor) body.start_cursor = cursor;

    const res = await notionFetch(token, "POST", "/search", body);
    const data = res as {
      results: Array<{
        id: string;
        title?: Array<{ plain_text?: string }>;
        last_edited_time: string;
      }>;
      next_cursor: string | null;
      has_more: boolean;
    };

    for (const db of data.results) {
      out.push({
        id: db.id,
        title_plain:
          db.title?.map((t) => t.plain_text ?? "").join("") || "(sin título)",
        last_edited_time: db.last_edited_time,
      });
    }

    cursor = data.has_more ? data.next_cursor ?? undefined : undefined;
  } while (cursor);
  return out;
}

/**
 * GET /v1/databases/:id — devuelve el schema de la database, con las
 * propiedades y opciones de cada select/multi_select/status. Se usa en el
 * form de configuración de mapping para saber qué columnas existen y con
 * qué valores.
 */
export async function retrieveDatabase(
  token: string,
  databaseId: string,
): Promise<NotionDatabaseSchema> {
  const res = await notionFetch(token, "GET", `/databases/${databaseId}`);
  const data = res as {
    id: string;
    title?: Array<{ plain_text?: string }>;
    properties: Record<
      string,
      {
        name?: string;
        type: string;
        select?: { options?: Array<{ name: string }> };
        multi_select?: { options?: Array<{ name: string }> };
        status?: { options?: Array<{ name: string }> };
      }
    >;
  };

  const props: NotionDatabaseSchema["properties"][number][] = [];
  for (const [name, spec] of Object.entries(data.properties)) {
    const opts =
      spec.select?.options ??
      spec.multi_select?.options ??
      spec.status?.options ??
      [];
    props.push({
      name: spec.name ?? name,
      type: spec.type,
      options: opts.map((o) => ({ name: o.name })),
    });
  }

  return {
    id: data.id,
    title_plain:
      data.title?.map((t) => t.plain_text ?? "").join("") || "(sin título)",
    properties: props,
  };
}

/**
 * POST /v1/databases/:id/query — trae los pages de una database. Paginado.
 * `filter` opcional (para sync incremental por `last_edited_time`).
 */
export async function queryDatabase(
  token: string,
  databaseId: string,
  opts?: {
    /** Notion filter object — pass-through al API. */
    readonly filter?: unknown;
    /** Sort spec — array de sorts. */
    readonly sorts?: unknown;
  },
): Promise<NotionPage[]> {
  const out: NotionPage[] = [];
  let cursor: string | undefined = undefined;
  do {
    const body: Record<string, unknown> = { page_size: 100 };
    if (opts?.filter) body.filter = opts.filter;
    if (opts?.sorts) body.sorts = opts.sorts;
    if (cursor) body.start_cursor = cursor;

    const res = await notionFetch(
      token,
      "POST",
      `/databases/${databaseId}/query`,
      body,
    );
    const data = res as {
      results: Array<{
        id: string;
        url: string;
        last_edited_time: string;
        created_time: string;
        properties: Record<string, unknown>;
      }>;
      next_cursor: string | null;
      has_more: boolean;
    };

    for (const page of data.results) {
      out.push({
        id: page.id,
        url: page.url,
        last_edited_time: page.last_edited_time,
        created_time: page.created_time,
        properties: page.properties,
      });
    }

    cursor = data.has_more ? data.next_cursor ?? undefined : undefined;
  } while (cursor);
  return out;
}

/**
 * GET /v1/users — lista todos los users del workspace (paginado).
 * Los users type='person' tienen email/name; los type='bot' no aportan al
 * mapeo pero se devuelven para que el caller los filtre.
 */
export async function listUsers(token: string): Promise<NotionUser[]> {
  const out: NotionUser[] = [];
  let cursor: string | undefined = undefined;
  do {
    const qs = new URLSearchParams({ page_size: "100" });
    if (cursor) qs.set("start_cursor", cursor);

    const res = await notionFetch(token, "GET", `/users?${qs.toString()}`);
    const data = res as {
      results: Array<{
        id: string;
        type: "person" | "bot";
        name: string | null;
        avatar_url: string | null;
        person?: { email?: string };
      }>;
      next_cursor: string | null;
      has_more: boolean;
    };

    for (const u of data.results) {
      out.push({
        id: u.id,
        name: u.name,
        email: u.person?.email ?? null,
        avatar_url: u.avatar_url,
        type: u.type,
      });
    }

    cursor = data.has_more ? data.next_cursor ?? undefined : undefined;
  } while (cursor);
  return out;
}

/**
 * GET /v1/comments?block_id={pageId} — trae los comentarios de una page.
 * Paginado con cursor. Notion trata los comentarios como children del
 * "block" que es el page id (mismo endpoint que para bloques con hilo).
 *
 * Los comentarios de Notion pueden estar anclados a una page ("unresolved
 * page-level") o a un bloque interno. Este endpoint devuelve solo los
 * page-level cuando se pasa el page id como block_id — que es lo que la
 * UI de Notion muestra en el panel de comentarios a la derecha.
 */
export async function listPageComments(
  token: string,
  pageId: string,
): Promise<NotionPageComment[]> {
  const out: NotionPageComment[] = [];
  let cursor: string | undefined = undefined;
  do {
    const qs = new URLSearchParams({ block_id: pageId, page_size: "100" });
    if (cursor) qs.set("start_cursor", cursor);

    const res = await notionFetch(token, "GET", `/comments?${qs.toString()}`);
    const data = res as {
      results: Array<{
        id: string;
        created_by?: { id?: string };
        created_time: string;
        last_edited_time: string;
        rich_text?: Array<{ plain_text?: string }>;
      }>;
      next_cursor: string | null;
      has_more: boolean;
    };

    for (const c of data.results) {
      const plain =
        c.rich_text?.map((t) => t.plain_text ?? "").join("") ?? "";
      out.push({
        id: c.id,
        notion_user_id: c.created_by?.id ?? null,
        content_plain: plain,
        created_time: c.created_time,
        last_edited_time: c.last_edited_time,
      });
    }

    cursor = data.has_more ? data.next_cursor ?? undefined : undefined;
  } while (cursor);
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// Interno — fetch con cabeceras + parsing de errores
// ═══════════════════════════════════════════════════════════════════════════

async function notionFetch(
  token: string,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<unknown> {
  const res = await fetch(`${NOTION_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_API_VERSION,
      "Content-Type": "application/json",
    },
    body: body != null ? JSON.stringify(body) : undefined,
    // Notion cacheado por Next.js sería peligroso — siempre fresco.
    cache: "no-store",
  });

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Body no-JSON: raro pero puede pasar en 5xx de Cloudflare.
  }

  if (!res.ok) {
    const errBody = json as { code?: string; message?: string } | null;
    throw new NotionApiError(
      res.status,
      errBody?.code ?? null,
      errBody?.message ?? `HTTP ${res.status}`,
    );
  }

  return json;
}
