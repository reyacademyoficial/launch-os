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
  parseAssignees,
  parseCheckbox,
  parseDateStart,
  parseRichText,
  parseSelect,
  parseTitle,
} from "./property-parser";
import {
  assigneeProps,
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
  /**
   * Nombre/email suelto → KG organization_people.id. Se usa en los tableros
   * cuya columna de responsable NO es type='people' (un multi_select con
   * nombres, texto libre, una fórmula). Opcional: sin este resolver esos
   * tableros simplemente quedan sin dueños, como antes.
   */
  readonly assigneeLabelToKgPerson?: (label: string) => string | null;
  /** Timestamp del sync — se guarda en `notion_synced_at`. */
  readonly nowIso: string;
}

/**
 * Resuelve el KG status de una page combinando las DOS formas en que los
 * tableros marcan "terminado":
 *
 *   a) Una columna select/status con un valor tipo "Listo" (`status_prop`).
 *   b) Un checkbox / tilde (`done_prop`).
 *
 * Cuando hay checkbox configurado MANDA él, porque es la señal explícita de
 * ese tablero:
 *   - tildado    → `done_status` (default 'listo').
 *   - destildado → el valor del select, salvo que el select también diga
 *     'listo' (contradicción): ahí gana el tilde y cae a `undone_status`.
 *
 * Sin `done_prop` el comportamiento es el de siempre: select → map explícito
 * → auto-normalización contra KG_STATUSES → 'sin_empezar'.
 *
 * Exportada para poder testearla sin armar una page completa.
 */
export function resolveStatus(
  page: Pick<NotionPage, "properties">,
  map: NotionPropertyMap,
): KgStatus {
  const doneStatus: KgStatus = map.done_status ?? "listo";
  const undoneStatus: KgStatus = map.undone_status ?? "sin_empezar";

  const fromSelect: KgStatus | null = map.status_prop
    ? applyValueMap<KgStatus>(
        parseSelect(page.properties, map.status_prop),
        map.status_map ?? {},
        undoneStatus,
        KG_STATUSES,
      )
    : null;

  if (map.done_prop) {
    const checked = parseCheckbox(page.properties, map.done_prop);
    if (checked === true) return doneStatus;
    if (checked === false) {
      return fromSelect != null && fromSelect !== doneStatus
        ? fromSelect
        : undoneStatus;
    }
    // checked === null: la columna no existe en esta page (schema cambiado,
    // page vieja). Caemos al select y no inventamos "terminado".
  }

  return fromSelect ?? undoneStatus;
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

  const status = resolveStatus(page, map);

  const priority: KgPriority = map.priority_prop
    ? applyValueMap<KgPriority>(
        parseSelect(page.properties, map.priority_prop),
        map.priority_map ?? {},
        "media",
        KG_PRIORITIES,
      )
    : "media";

  // Assignees: recorre TODAS las columnas de responsable configuradas y junta
  // las personas KG resueltas — primero por notion user id, después por
  // nombre/email para los tableros que no usan una columna `people`. Dedup
  // preservando orden (la junction no tiene rank, pero el orden ayuda en UI).
  const ownerIds: string[] = [];
  const seenOwners = new Set<string>();
  for (const propName of assigneeProps(map)) {
    const { userIds, labels } = parseAssignees(page.properties, propName);
    for (const nu of userIds) {
      const kg = ctx.assigneeToKgPerson(nu);
      if (kg && !seenOwners.has(kg)) {
        seenOwners.add(kg);
        ownerIds.push(kg);
      }
    }
    if (!ctx.assigneeLabelToKgPerson) continue;
    for (const label of labels) {
      const kg = ctx.assigneeLabelToKgPerson(label);
      if (kg && !seenOwners.has(kg)) {
        seenOwners.add(kg);
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
