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

  /**
   * Opcional. Columna con el estado. Aceptamos 'select', 'status',
   * 'multi_select' (se usa la primera opción), y 'formula'/'rollup' que
   * resuelvan a string — hay tableros que derivan el estado por fórmula.
   */
  readonly status_prop?: string;
  /** Notion value → KG status. Valores KG deben estar en KG_STATUSES. */
  readonly status_map?: Record<string, KgStatus>;

  /**
   * Opcional. Columna type='checkbox' (o formula de tipo checkbox) que marca
   * la tarea como terminada. Existe porque no todos los tableros usan un
   * select "Listo": muchos usan un tilde. Cuando está seteada MANDA sobre
   * `status_prop` (es la señal explícita de "hecho" del tablero):
   *
   *   tildado    → `done_status`   (default 'listo')
   *   sin tildar → el valor de `status_prop` si resuelve a algo distinto de
   *                `done_status`; si no, `undone_status` (default
   *                'sin_empezar'). Así un tablero con checkbox destildado
   *                nunca queda pegado en 'listo'.
   */
  readonly done_prop?: string;
  /** KG status cuando el checkbox está tildado. Default 'listo'. */
  readonly done_status?: KgStatus;
  /** KG status cuando está destildado y no hay otro estado. Default 'sin_empezar'. */
  readonly undone_status?: KgStatus;

  /** Opcional. Nombre de la columna type='select' con la prioridad. */
  readonly priority_prop?: string;
  /** Notion value → KG priority. Valores KG deben estar en KG_PRIORITIES. */
  readonly priority_map?: Record<string, KgPriority>;

  /**
   * Opcional. Columna principal de responsables. Ya no exigimos type='people':
   * también leemos 'multi_select'/'select' (por nombre), 'rich_text' con
   * @menciones, 'created_by'/'last_edited_by', y 'formula'/'rollup' que
   * devuelvan texto o gente. Ver `parseAssignees`.
   */
  readonly assignee_prop?: string;
  /**
   * Opcional. Columnas ADICIONALES de responsables — algunos tableros parten
   * el dato ("Responsable" + "Apoyo", o "Owner" people + "Equipo"
   * multi_select). Se unen todas y se dedupean.
   */
  readonly assignee_props?: readonly string[];

  /** Opcional. Nombre de la columna type='date' con la fecha de vencimiento. */
  readonly due_prop?: string;

  /** Opcional. Nombre de la columna type='date' con la fecha de inicio. */
  readonly start_prop?: string;

  /** Opcional. Nombre de la columna type='rich_text' con la descripción. */
  readonly description_prop?: string;

  /**
   * Escribir de vuelta en Notion cuando se edita el proyecto en KG.
   * Default true (undefined = true) — es lo que espera el operador que
   * marca "listo" en la app. Se apaga por database si esa DB debe ser
   * estrictamente read-only.
   */
  readonly write_back?: boolean;
}

/**
 * Todas las columnas de responsables configuradas, dedupeadas y en orden
 * (`assignee_prop` primero). Centralizado porque lo usan el mapper, el push
 * y la UI.
 */
export function assigneeProps(map: NotionPropertyMap): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of [map.assignee_prop, ...(map.assignee_props ?? [])]) {
    if (!p || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

/** Write-back activo por default: solo `false` explícito lo apaga. */
export function isWriteBackEnabled(map: NotionPropertyMap): boolean {
  return map.write_back !== false;
}

// ═══════════════════════════════════════════════════════════════════════════
// Type guards / normalizadores
// ═══════════════════════════════════════════════════════════════════════════

function isString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isKgStatus(v: unknown): v is KgStatus {
  return typeof v === "string" && (KG_STATUSES as string[]).includes(v);
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
    done_prop?: string;
    done_status?: KgStatus;
    undone_status?: KgStatus;
    priority_prop?: string;
    priority_map?: Record<string, KgPriority>;
    assignee_prop?: string;
    assignee_props?: string[];
    due_prop?: string;
    start_prop?: string;
    description_prop?: string;
    write_back?: boolean;
  } = { title_prop: title };

  if (isString(obj.status_prop)) out.status_prop = obj.status_prop;
  if (isString(obj.done_prop)) out.done_prop = obj.done_prop;
  if (isKgStatus(obj.done_status)) out.done_status = obj.done_status;
  if (isKgStatus(obj.undone_status)) out.undone_status = obj.undone_status;
  if (isString(obj.priority_prop)) out.priority_prop = obj.priority_prop;
  if (isString(obj.assignee_prop)) out.assignee_prop = obj.assignee_prop;
  if (Array.isArray(obj.assignee_props)) {
    const extra = obj.assignee_props.filter(isString);
    if (extra.length > 0) out.assignee_props = extra;
  }
  if (isString(obj.due_prop)) out.due_prop = obj.due_prop;
  if (isString(obj.start_prop)) out.start_prop = obj.start_prop;
  if (isString(obj.description_prop))
    out.description_prop = obj.description_prop;
  if (typeof obj.write_back === "boolean") out.write_back = obj.write_back;

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
  if (map.done_prop) out.done_prop = map.done_prop;
  if (map.done_status) out.done_status = map.done_status;
  if (map.undone_status) out.undone_status = map.undone_status;
  if (map.priority_prop) out.priority_prop = map.priority_prop;
  if (map.priority_map) out.priority_map = map.priority_map;
  if (map.assignee_prop) out.assignee_prop = map.assignee_prop;
  // Guardamos solo las extra que no dupliquen la principal.
  const extraAssignees = (map.assignee_props ?? []).filter(
    (p) => p && p !== map.assignee_prop,
  );
  if (extraAssignees.length > 0) out.assignee_props = extraAssignees;
  if (map.due_prop) out.due_prop = map.due_prop;
  if (map.start_prop) out.start_prop = map.start_prop;
  if (map.description_prop) out.description_prop = map.description_prop;
  // Solo persistimos el flag cuando apaga el write-back — el default es on.
  if (map.write_back === false) out.write_back = false;
  return out;
}
