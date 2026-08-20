/**
 * Función pura que traduce una NotionPage a un shape listo para upsert en
 * `internal_projects` + `internal_project_owners` (0140).
 *
 * INPUTS
 *   - page (raw properties de Notion)
 *   - map (property_map de notion_databases parseado)
 *   - assigneeToKgPerson: resolver que dado un notion_user_id devuelve el
 *     kg_person_id mapeado (o null). Precomputado del caller para evitar
 *     N queries a notion_users por page.
 *   - context (organization_id + workspace_id + database_id)
 *
 * OUTPUT
 *   { ok, payload } o { ok: false, reason } — el sync decide qué hacer.
 *   Solo rebota si el título es null (name es NOT NULL en el DB).
 *
 * `owner_ids` es un arreglo deduplicado de kg_person_ids. Vacío si el
 * assignee_prop no está configurado o si ningún notion user está mapeado.
 * El caller (sync-runner) reemplaza la lista de owners de la junction en
 * cada corrida — todo lo que no venga en `owner_ids` sale del proyecto.
 */

import type { NotionPage } from "./client";
import {
  applyValueMap,
  parseDateStart,
  parsePeople,
  parseRichText,
  parseSelect,
  parseTitle,
} from "./property-parser";
import {
  KG_PRIORITIES,
  KG_STATUSES,
  type KgPriority,
  type KgStatus,
  type NotionPropertyMap,
} from "./property-map";

export interface InternalProjectUpsertPayload {
  organization_id: string;
  name: string;
  description: string | null;
  status: KgStatus;
  priority: KgPriority;
  starts_on: string | null;
  due_on: string | null;
  notion_page_id: string;
  notion_database_id: string;
  notion_workspace_id: string;
  notion_synced_at: string;
}

export interface MappedProject {
  /** Payload plano para upsert en internal_projects. */
  readonly payload: InternalProjectUpsertPayload;
  /** kg_person_ids únicos que van a la junction internal_project_owners. */
  readonly ownerIds: readonly string[];
}

export type MapResult =
  | { ok: true; result: MappedProject }
  | { ok: false; reason: "missing-title" | "invalid-map" };

export interface MapContext {
  readonly organizationId: string;
  readonly workspaceId: string;
  readonly databaseId: string;
  /**
   * Notion user id → KG organization_people.id (o null si no mapeado o si
   * la persona ya no está en la org). Precomputado del sync.
   */
  readonly assigneeToKgPerson: (notionUserId: string) => string | null;
  /** Timestamp del sync — se guarda en `notion_synced_at`. */
  readonly nowIso: string;
}

export function mapNotionPageToInternalProject(
  page: NotionPage,
  map: NotionPropertyMap,
  ctx: MapContext,
): MapResult {
  const name = parseTitle(page.properties, map.title_prop);
  if (!name) {
    return { ok: false, reason: "missing-title" };
  }

  // Status: aplicamos map explícito con fallback a auto-normalización
  // contra KG_STATUSES (ver property-parser.applyValueMap). Si nada
  // resuelve, cae a 'sin_empezar'.
  const status: KgStatus = map.status_prop
    ? applyValueMap<KgStatus>(
        parseSelect(page.properties, map.status_prop),
        map.status_map ?? {},
        "sin_empezar",
        KG_STATUSES,
      )
    : "sin_empezar";

  const priority: KgPriority = map.priority_prop
    ? applyValueMap<KgPriority>(
        parseSelect(page.properties, map.priority_prop),
        map.priority_map ?? {},
        "media",
        KG_PRIORITIES,
      )
    : "media";

  // Assignees: junta TODOS los notion users mapeados a personas KG. Dedup
  // preservando orden — el orden importa poco (junction table sin rank).
  const ownerIds: string[] = [];
  if (map.assignee_prop) {
    const people = parsePeople(page.properties, map.assignee_prop);
    const seen = new Set<string>();
    for (const nu of people) {
      const kg = ctx.assigneeToKgPerson(nu);
      if (kg && !seen.has(kg)) {
        seen.add(kg);
        ownerIds.push(kg);
      }
    }
  }

  const dueOn = map.due_prop
    ? parseDateStart(page.properties, map.due_prop)
    : null;
  const startsOn = map.start_prop
    ? parseDateStart(page.properties, map.start_prop)
    : null;

  const description = map.description_prop
    ? parseRichText(page.properties, map.description_prop)
    : null;

  return {
    ok: true,
    result: {
      payload: {
        organization_id: ctx.organizationId,
        name,
        description,
        status,
        priority,
        starts_on: startsOn,
        due_on: dueOn,
        notion_page_id: page.id,
        notion_database_id: ctx.databaseId,
        notion_workspace_id: ctx.workspaceId,
        notion_synced_at: ctx.nowIso,
      },
      ownerIds,
    },
  };
}
