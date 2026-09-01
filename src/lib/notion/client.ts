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
  /** URL pública en Notion — sirve para "Abrir en Notion" en la UI. */
  readonly url: string | null;
  /** Emoji del ícono (si tiene). Null si custom-image o sin ícono. */
  readonly icon_emoji: string | null;
  /**
   * Padre según el API de Notion. `workspace` = la DB vive en la raíz del
   * workspace. `page_id` / `database_id` = está anidada dentro de otro objeto.
   */
  readonly parent_type: "workspace" | "page_id" | "database_id" | null;
  readonly parent_id: string | null;
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
        url?: string;
        icon?: { type: string; emoji?: string } | null;
        parent?: {
          type: "workspace" | "page_id" | "database_id" | "block_id";
          page_id?: string;
          database_id?: string;
          block_id?: string;
          workspace?: boolean;
        };
      }>;
      next_cursor: string | null;
      has_more: boolean;
    };

    for (const db of data.results) {
      const parentType =
        db.parent?.type === "workspace"
          ? "workspace"
          : db.parent?.type === "page_id"
            ? "page_id"
            : db.parent?.type === "database_id"
              ? "database_id"
              : null;
      const parentId =
        db.parent?.type === "page_id"
          ? db.parent.page_id ?? null
          : db.parent?.type === "database_id"
            ? db.parent.database_id ?? null
            : null;
      out.push({
        id: db.id,
        title_plain:
          db.title?.map((t) => t.plain_text ?? "").join("") || "(sin título)",
        last_edited_time: db.last_edited_time,
        url: db.url ?? null,
        icon_emoji:
          db.icon?.type === "emoji" ? db.icon.emoji ?? null : null,
        parent_type: parentType,
        parent_id: parentId,
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
 * Resuelve el título de un padre — page o database — con una llamada.
 * Se usa para poblar `parent_title` en `notion_databases` (breadcrumb en UI).
 * Devuelve null si el objeto no existe o no tiene título accesible; nunca
 * tira: los errores se capturan y logan al log del caller (no queremos que
 * un padre inaccesible aborte todo el discover).
 */
export async function retrieveParentTitle(
  token: string,
  parentType: "page_id" | "database_id",
  parentId: string,
): Promise<string | null> {
  try {
    if (parentType === "database_id") {
      const res = await notionFetch(token, "GET", `/databases/${parentId}`);
      const data = res as {
        title?: Array<{ plain_text?: string }>;
      };
      const t = data.title?.map((x) => x.plain_text ?? "").join("") ?? "";
      return t || null;
    }
    // parent_type === 'page_id' — el título vive en properties como una prop
    // de type 'title'. Puede llamarse "Name", "Title", o lo que el user haya
    // puesto, así que iteramos las properties buscando el shape de title.
    const res = await notionFetch(token, "GET", `/pages/${parentId}`);
    const data = res as {
      properties?: Record<
        string,
        { type?: string; title?: Array<{ plain_text?: string }> }
      >;
    };
    for (const prop of Object.values(data.properties ?? {})) {
      if (prop.type === "title" && prop.title) {
        const t = prop.title.map((x) => x.plain_text ?? "").join("");
        if (t) return t;
      }
    }
    return null;
  } catch {
    return null;
  }
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

/**
 * Rich-text block que Notion acepta en `POST /v1/comments`. Subset del
 * shape completo — solo lo que usamos: text plano + mention de usuario.
 */
export type NotionRichTextBlock =
  | { readonly type: "text"; readonly text: { readonly content: string } }
  | {
      readonly type: "mention";
      readonly mention: { readonly user: { readonly id: string } };
    };

export interface NotionCommentCreated {
  readonly id: string;
  readonly created_time: string;
  readonly last_edited_time: string;
}

/**
 * POST /v1/comments — crea un comentario a nivel de page. Notion notifica
 * a los users mencionados dentro del rich_text (bloques `mention.user.id`).
 * El comentario aparece firmado por el bot de la integration; para
 * preservar autoría del usuario KG prefijamos el content en el caller.
 */
export async function postPageComment(
  token: string,
  pageId: string,
  richText: readonly NotionRichTextBlock[],
): Promise<NotionCommentCreated> {
  const res = await notionFetch(token, "POST", "/comments", {
    parent: { page_id: pageId },
    rich_text: richText,
  });
  const data = res as {
    id: string;
    created_time: string;
    last_edited_time: string;
  };
  return {
    id: data.id,
    created_time: data.created_time,
    last_edited_time: data.last_edited_time,
  };
}

/**
 * PATCH /v1/pages/:id — escribe propiedades de vuelta en Notion (write-back).
 *
 * `properties` va tal cual al body: es el shape nativo de Notion, con la
 * misma forma que devuelve el GET pero solo con las props a modificar. Ej:
 *
 *   { "Estado": { "status":   { "name": "Listo" } },
 *     "Hecho":  { "checkbox": true } }
 *
 * Notion ignora las props que no se mandan — es un patch parcial real, no un
 * replace. Si una prop no existe en la database, responde 400 con
 * `validation_error`; el caller lo captura y lo guarda en
 * `internal_projects.notion_push_error`.
 *
 * REQUISITO DE PERMISOS
 *   El internal integration necesita la capability "Update content" sobre la
 *   page. Sin eso Notion responde 403 aunque el token sirva para leer.
 */
export async function updatePageProperties(
  token: string,
  pageId: string,
  properties: Record<string, unknown>,
): Promise<void> {
  await notionFetch(token, "PATCH", `/pages/${pageId}`, { properties });
}

// ═══════════════════════════════════════════════════════════════════════════
// Interno — fetch con cabeceras + parsing de errores
// ═══════════════════════════════════════════════════════════════════════════

async function notionFetch(
  token: string,
  method: "GET" | "POST" | "PATCH",
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
