import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  NotionApiError,
  retrieveDatabase as apiRetrieveDatabase,
  updatePageProperties as apiUpdatePageProperties,
  type NotionDatabaseSchema,
} from "@/lib/notion/client";
import {
  assigneeProps,
  isWriteBackEnabled,
  parsePropertyMap,
  type KgPriority,
  type KgStatus,
  type NotionPropertyMap,
} from "@/lib/notion/property-map";
import { normalizeEnumLabel } from "@/lib/notion/property-parser";

/**
 * Write-back KG → Notion (0176).
 *
 * POR QUÉ EXISTE
 *   El sync de 0132 era one-way. Marcar un proyecto como 'listo' en KG
 *   actualizaba solo la fila local, y el siguiente sync leía Notion (que
 *   seguía viejo) y lo pisaba: "los proyectos vuelven solos al estado
 *   original". Acá empujamos el cambio a la page antes de que eso pase.
 *
 * QUÉ SE ESCRIBE
 *   Solo las propiedades mapeadas y ESCRIBIBLES de la database:
 *     título, descripción, status (select/status), checkbox de "listo",
 *     prioridad, fechas de inicio/vencimiento y responsables (solo si la
 *     columna es type='people' — ver más abajo).
 *   Nunca tocamos `formula` ni `rollup`: son read-only en la API de Notion
 *   y un PATCH sobre ellas devuelve 400.
 *
 * RESPONSABLES
 *   Solo se empujan a columnas type='people', traduciendo la persona KG a su
 *   notion_user_id vía `notion_users.kg_person_id`. Un tablero que anota
 *   responsables como multi_select o texto libre se LEE bien (ver
 *   `parseAssignees`) pero no se escribe: crear opciones nuevas en el
 *   tablero de otro equipo es demasiado invasivo.
 *
 * FALLOS
 *   Cualquier error deja `notion_push_pending = true` + `notion_push_error`.
 *   El sync-runner ve esa marca, NO pisa el proyecto con el valor viejo de
 *   Notion, y reintenta el push en la próxima corrida.
 */

// Mismo patrón que sync-runner: las tablas notion_* no están en el tipo
// generado `Database`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- el tipo generado `Database` no incluye las tablas notion_*.
type AnySupabase = SupabaseClient<any, any, any>;

export type PushProjectResult =
  | { ok: true; pushed: true }
  /** El proyecto no es de Notion, o la DB tiene write_back apagado. */
  | { ok: true; pushed: false; reason: string }
  | { ok: false; error: string };

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  priority: string;
  starts_on: string | null;
  due_on: string | null;
  notion_page_id: string | null;
  notion_database_id: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Entrada principal
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Empuja un `internal_project` a su page de Notion.
 *
 * `supabase` debe poder leer `notion_workspaces.secret_token` — en la
 * práctica el service client, porque el RLS de 0132 restringe esa tabla a
 * superadmin y cualquier operador con permiso de editar proyectos tiene que
 * poder marcar "listo".
 */
export async function pushProjectToNotion(
  projectId: string,
  supabase: AnySupabase,
): Promise<PushProjectResult> {
  const projRes = await supabase
    .from("internal_projects")
    .select(
      "id, name, description, status, priority, starts_on, due_on, notion_page_id, notion_database_id",
    )
    .eq("id", projectId)
    .maybeSingle();
  const project = projRes.data as ProjectRow | null;
  if (!project) return { ok: false, error: "Proyecto no encontrado." };
  if (!project.notion_page_id) {
    return { ok: true, pushed: false, reason: "not-notion-sourced" };
  }
  if (!project.notion_database_id) {
    return await markPushFailed(
      supabase,
      projectId,
      "El proyecto no tiene database de Notion asociada.",
    );
  }

  const dbRes = await supabase
    .from("notion_databases")
    .select("id, notion_id, workspace_id, property_map, enabled")
    .eq("id", project.notion_database_id)
    .maybeSingle();
  const db = dbRes.data as
    | {
        id: string;
        notion_id: string;
        workspace_id: string;
        property_map: unknown;
        enabled: boolean;
      }
    | null;
  if (!db) {
    return await markPushFailed(
      supabase,
      projectId,
      "La database de Notion de origen ya no existe en la configuración.",
    );
  }

  const map = parsePropertyMap(db.property_map);
  if (!map) {
    return await markPushFailed(
      supabase,
      projectId,
      "El mapeo de propiedades de esa database no está configurado.",
    );
  }
  if (!isWriteBackEnabled(map)) {
    return { ok: true, pushed: false, reason: "write-back-disabled" };
  }

  const wsRes = await supabase
    .from("notion_workspaces")
    .select("secret_token, enabled")
    .eq("id", db.workspace_id)
    .maybeSingle();
  const ws = wsRes.data as
    | { secret_token: string; enabled: boolean }
    | null;
  if (!ws) {
    return await markPushFailed(
      supabase,
      projectId,
      "El workspace de Notion de origen ya no existe.",
    );
  }
  if (!ws.enabled) {
    return { ok: true, pushed: false, reason: "workspace-disabled" };
  }

  // Schema en vivo: necesitamos el TIPO real de cada columna (select vs
  // status vs checkbox) y sus opciones para traducir el valor KG a la
  // etiqueta exacta que espera Notion. Una llamada por guardado; los
  // guardados son acciones humanas, no un loop.
  let schema: NotionDatabaseSchema;
  try {
    schema = await apiRetrieveDatabase(ws.secret_token, db.notion_id);
  } catch (e) {
    return await markPushFailed(supabase, projectId, describeNotionError(e));
  }

  const ownerNotionIds = await resolveOwnerNotionUserIds(
    supabase,
    projectId,
    db.workspace_id,
  );

  const properties = buildNotionPatch(
    {
      name: project.name,
      description: project.description,
      status: project.status as KgStatus,
      priority: project.priority as KgPriority,
      startsOn: project.starts_on,
      dueOn: project.due_on,
      ownerNotionUserIds: ownerNotionIds,
    },
    map,
    schema,
  );

  if (Object.keys(properties).length === 0) {
    // Nada mapeado que sea escribible — no es un error, pero tampoco hay
    // nada pendiente: limpiamos la marca para no bloquear el sync.
    await clearPushPending(supabase, projectId);
    return { ok: true, pushed: false, reason: "nothing-writable" };
  }

  try {
    await apiUpdatePageProperties(
      ws.secret_token,
      project.notion_page_id,
      properties,
    );
  } catch (e) {
    return await markPushFailed(supabase, projectId, describeNotionError(e));
  }

  await clearPushPending(supabase, projectId);
  return { ok: true, pushed: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// Construcción del patch — pura y testeable
// ═══════════════════════════════════════════════════════════════════════════

export interface ProjectPushValues {
  readonly name: string;
  readonly description: string | null;
  readonly status: KgStatus;
  readonly priority: KgPriority;
  readonly startsOn: string | null;
  readonly dueOn: string | null;
  /** Notion user ids de los responsables, ya traducidos desde KG. */
  readonly ownerNotionUserIds: readonly string[];
}

/**
 * Arma el body `properties` del PATCH. Solo incluye columnas que:
 *   (a) están mapeadas,
 *   (b) existen todavía en el schema de la database, y
 *   (c) son de un tipo escribible (nada de formula/rollup/created_by).
 *
 * Si el status KG no tiene una opción equivalente en Notion, esa columna se
 * omite en vez de mandar basura — mejor no escribir el estado que romper el
 * PATCH entero con un 400.
 */
export function buildNotionPatch(
  values: ProjectPushValues,
  map: NotionPropertyMap,
  schema: NotionDatabaseSchema,
): Record<string, unknown> {
  const byName = new Map(schema.properties.map((p) => [p.name, p]));
  const out: Record<string, unknown> = {};

  const typeOf = (propName: string | undefined): string | null =>
    propName ? byName.get(propName)?.type ?? null : null;

  // ─── Título ───────────────────────────────────────────────────────────
  if (typeOf(map.title_prop) === "title") {
    out[map.title_prop] = {
      title: [{ type: "text", text: { content: values.name } }],
    };
  }

  // ─── Descripción ──────────────────────────────────────────────────────
  if (map.description_prop && typeOf(map.description_prop) === "rich_text") {
    out[map.description_prop] = {
      rich_text:
        values.description == null || values.description.length === 0
          ? []
          : [{ type: "text", text: { content: values.description } }],
    };
  }

  // ─── Checkbox de "listo" ──────────────────────────────────────────────
  // Solo si es un checkbox real: una formula de tipo checkbox es read-only.
  const doneStatus: KgStatus = map.done_status ?? "listo";
  if (map.done_prop && typeOf(map.done_prop) === "checkbox") {
    out[map.done_prop] = { checkbox: values.status === doneStatus };
  }

  // ─── Status select/status ─────────────────────────────────────────────
  const statusType = typeOf(map.status_prop);
  if (map.status_prop && (statusType === "select" || statusType === "status")) {
    const optionNames = (byName.get(map.status_prop)?.options ?? []).map(
      (o) => o.name,
    );
    const notionValue = reverseLookup(
      values.status,
      map.status_map ?? {},
      optionNames,
    );
    if (notionValue != null) {
      out[map.status_prop] =
        statusType === "status"
          ? { status: { name: notionValue } }
          : { select: { name: notionValue } };
    }
  }

  // ─── Prioridad ────────────────────────────────────────────────────────
  const priorityType = typeOf(map.priority_prop);
  if (
    map.priority_prop &&
    (priorityType === "select" || priorityType === "status")
  ) {
    const optionNames = (byName.get(map.priority_prop)?.options ?? []).map(
      (o) => o.name,
    );
    const notionValue = reverseLookup(
      values.priority,
      map.priority_map ?? {},
      optionNames,
    );
    if (notionValue != null) {
      out[map.priority_prop] =
        priorityType === "status"
          ? { status: { name: notionValue } }
          : { select: { name: notionValue } };
    }
  }

  // ─── Fechas ───────────────────────────────────────────────────────────
  if (map.due_prop && typeOf(map.due_prop) === "date") {
    out[map.due_prop] = values.dueOn ? { date: { start: values.dueOn } } : { date: null };
  }
  if (map.start_prop && typeOf(map.start_prop) === "date") {
    out[map.start_prop] = values.startsOn
      ? { date: { start: values.startsOn } }
      : { date: null };
  }

  // ─── Responsables — solo columnas people ──────────────────────────────
  for (const propName of assigneeProps(map)) {
    if (typeOf(propName) !== "people") continue;
    out[propName] = {
      people: values.ownerNotionUserIds.map((id) => ({ object: "user", id })),
    };
  }

  return out;
}

/**
 * KG value → etiqueta de Notion.
 *
 *   1) Invierte el map explícito que configuró el operador (si "Terminado"
 *      → 'listo', escribimos "Terminado").
 *   2) Si no hay, busca entre las opciones reales de la columna una cuya
 *      etiqueta normalizada coincida con el valor KG ("Alerta Máxima" →
 *      alerta_maxima). Es el espejo del auto-match de la lectura.
 *   3) null si nada matchea — el caller omite la propiedad.
 */
export function reverseLookup(
  kgValue: string,
  valueMap: Readonly<Record<string, string>>,
  optionNames: readonly string[],
): string | null {
  const options = new Set(optionNames);

  // 1) Map explícito. Preferimos una clave que exista de verdad en la
  //    database; si el operador dejó mapeos viejos, no los usamos a ciegas.
  let staleCandidate: string | null = null;
  for (const [notionValue, mapped] of Object.entries(valueMap)) {
    if (mapped !== kgValue) continue;
    if (options.size === 0 || options.has(notionValue)) return notionValue;
    staleCandidate ??= notionValue;
  }

  // 2) Auto-match contra las opciones reales.
  for (const name of optionNames) {
    if (normalizeEnumLabel(name) === kgValue) return name;
  }

  // 3) Último recurso: el mapeo explícito aunque la opción ya no figure en
  //    el schema que leímos (puede ser un schema cacheado por Notion).
  return staleCandidate;
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers de estado del push
// ═══════════════════════════════════════════════════════════════════════════

/** Marca el proyecto como "cambio local sin escribir en Notion". */
export async function markPushPending(
  supabase: AnySupabase,
  projectId: string,
): Promise<void> {
  await supabase
    .from("internal_projects")
    .update({ notion_push_pending: true } as never)
    .eq("id", projectId);
}

async function clearPushPending(
  supabase: AnySupabase,
  projectId: string,
): Promise<void> {
  const nowIso = new Date().toISOString();
  await supabase
    .from("internal_projects")
    .update({
      notion_push_pending: false,
      notion_push_error: null,
      notion_pushed_at: nowIso,
      // Notion ya tiene nuestro valor: adelantamos el reloj de sync para que
      // la lectura siguiente no lo trate como "más viejo que Notion".
      notion_synced_at: nowIso,
    } as never)
    .eq("id", projectId);
}

async function markPushFailed(
  supabase: AnySupabase,
  projectId: string,
  error: string,
): Promise<PushProjectResult> {
  await supabase
    .from("internal_projects")
    .update({
      notion_push_pending: true,
      notion_push_error: error,
    } as never)
    .eq("id", projectId);
  return { ok: false, error };
}

/** Personas KG del proyecto → notion_user_id del workspace correspondiente. */
async function resolveOwnerNotionUserIds(
  supabase: AnySupabase,
  projectId: string,
  workspaceId: string,
): Promise<string[]> {
  const ownersRes = await supabase
    .from("internal_project_owners")
    .select("person_id")
    .eq("internal_project_id", projectId);
  const personIds = ((ownersRes.data ?? []) as Array<{ person_id: string }>).map(
    (r) => r.person_id,
  );
  if (personIds.length === 0) return [];

  const usersRes = await supabase
    .from("notion_users")
    .select("notion_user_id, kg_person_id")
    .eq("workspace_id", workspaceId)
    .in("kg_person_id", personIds);

  return ((usersRes.data ?? []) as Array<{ notion_user_id: string }>).map(
    (r) => r.notion_user_id,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Mensajes de error de Notion — compartido con el sync-runner
// ═══════════════════════════════════════════════════════════════════════════

export function describeNotionError(e: unknown): string {
  if (e instanceof NotionApiError) {
    if (e.status === 401) {
      return "Token inválido o revocado. Revisá que copiaste el 'Internal Integration Secret' correctamente.";
    }
    if (e.status === 403) {
      return "El token es válido pero no tiene permisos suficientes. En Notion, la integration necesita la capability 'Update content' sobre esa database.";
    }
    if (e.status === 404) {
      return "Notion no encuentra la page o la database. Puede haber sido archivada, o la integration perdió el acceso.";
    }
    if (e.status === 429) {
      return "Notion está limitando las peticiones. Esperá unos segundos e intentá de nuevo.";
    }
    return `Notion respondió ${e.status}: ${e.message}`;
  }
  if (e instanceof Error) return e.message;
  return "Error desconocido al hablar con Notion.";
}
