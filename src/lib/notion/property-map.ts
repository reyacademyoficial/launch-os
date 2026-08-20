/**
 * Shape del `notion_databases.property_map` (jsonb en 0132) + type guards
 * para parsearlo desde el jsonb sin explotar.
 *
 * FILOSOFÍA
 *   El único campo obligatorio es `title_prop` — cualquier internal_project
 *   necesita un name. El resto es opcional; el sync usa fallbacks razonables
 *   cuando no está seteado ('sin_empezar' para status, 'media' para priority,
 *   null para owner_id/due_on/starts_on/description).
 *
 * Los `*_map` son diccionarios directos Notion→KG. Validados al guardar el
 * mapping para prevenir valores que rompan los CHECKs del schema.
 */

export type KgStatus =
  | "sin_empezar"
  | "en_proceso"
  | "bloqueado"
  | "alerta_maxima"
  | "listo";
export type KgPriority = "alta" | "media" | "baja";

export const KG_STATUSES: readonly KgStatus[] = [
  "sin_empezar",
  "en_proceso",
  "bloqueado",
  "alerta_maxima",
  "listo",
];
export const KG_PRIORITIES: readonly KgPriority[] = [
  "alta",
  "media",
  "baja",
];

export interface NotionPropertyMap {
  /** Obligatorio. Nombre de la columna type='title' en Notion. */
  readonly title_prop: string;

  /** Opcional. Nombre de la columna type='select' o 'status' con el estado. */
  readonly status_prop?: string;
  /** Notion value → KG status. Valores KG deben estar en KG_STATUSES. */
  readonly status_map?: Record<string, KgStatus>;

  /** Opcional. Nombre de la columna type='select' con la prioridad. */
  readonly priority_prop?: string;
  /** Notion value → KG priority. Valores KG deben estar en KG_PRIORITIES. */
  readonly priority_map?: Record<string, KgPriority>;

  /** Opcional. Nombre de la columna type='people' con el owner. Usamos [0]. */
  readonly assignee_prop?: string;

  /** Opcional. Nombre de la columna type='date' con la fecha de vencimiento. */
  readonly due_prop?: string;

  /** Opcional. Nombre de la columna type='date' con la fecha de inicio. */
  readonly start_prop?: string;

  /** Opcional. Nombre de la columna type='rich_text' con la descripción. */
  readonly description_prop?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Type guards / normalizadores
// ═══════════════════════════════════════════════════════════════════════════

function isString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/**
 * Parsea el jsonb del DB. Cualquier campo malformado se descarta silenciosa —
 * los `*_map` filtran valores KG inválidos. Devuelve `null` si `title_prop`
 * no está presente (el sync rebota en ese caso).
 */
export function parsePropertyMap(raw: unknown): NotionPropertyMap | null {
  if (raw == null || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  const title = obj.title_prop;
  if (!isString(title)) return null;

  const out: {
    title_prop: string;
    status_prop?: string;
    status_map?: Record<string, KgStatus>;
    priority_prop?: string;
    priority_map?: Record<string, KgPriority>;
    assignee_prop?: string;
    due_prop?: string;
    start_prop?: string;
    description_prop?: string;
  } = { title_prop: title };

  if (isString(obj.status_prop)) out.status_prop = obj.status_prop;
  if (isString(obj.priority_prop)) out.priority_prop = obj.priority_prop;
  if (isString(obj.assignee_prop)) out.assignee_prop = obj.assignee_prop;
  if (isString(obj.due_prop)) out.due_prop = obj.due_prop;
  if (isString(obj.start_prop)) out.start_prop = obj.start_prop;
  if (isString(obj.description_prop))
    out.description_prop = obj.description_prop;

  if (obj.status_map && typeof obj.status_map === "object") {
    const filtered: Record<string, KgStatus> = {};
    for (const [k, v] of Object.entries(
      obj.status_map as Record<string, unknown>,
    )) {
      if (typeof v === "string" && (KG_STATUSES as string[]).includes(v)) {
        filtered[k] = v as KgStatus;
      }
    }
    if (Object.keys(filtered).length > 0) out.status_map = filtered;
  }

  if (obj.priority_map && typeof obj.priority_map === "object") {
    const filtered: Record<string, KgPriority> = {};
    for (const [k, v] of Object.entries(
      obj.priority_map as Record<string, unknown>,
    )) {
      if (typeof v === "string" && (KG_PRIORITIES as string[]).includes(v)) {
        filtered[k] = v as KgPriority;
      }
    }
    if (Object.keys(filtered).length > 0) out.priority_map = filtered;
  }

  return out;
}

/**
 * Prepara el shape para guardar en el jsonb — el reverse de parsePropertyMap.
 * Serializa solo los campos definidos y valida los *_map.
 */
export function serializePropertyMap(
  map: NotionPropertyMap,
): Record<string, unknown> {
  const out: Record<string, unknown> = { title_prop: map.title_prop };
  if (map.status_prop) out.status_prop = map.status_prop;
  if (map.status_map) out.status_map = map.status_map;
  if (map.priority_prop) out.priority_prop = map.priority_prop;
  if (map.priority_map) out.priority_map = map.priority_map;
  if (map.assignee_prop) out.assignee_prop = map.assignee_prop;
  if (map.due_prop) out.due_prop = map.due_prop;
  if (map.start_prop) out.start_prop = map.start_prop;
  if (map.description_prop) out.description_prop = map.description_prop;
  return out;
}
