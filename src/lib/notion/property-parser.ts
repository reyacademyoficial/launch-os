/**
 * Extractores de valores tipados desde el shape crudo de una `NotionPage.properties`.
 *
 * Notion devuelve cada propiedad como `{ id, type, [type]: valueForType }`.
 * Estos helpers pura JS convierten el shape a algo directamente usable por
 * el sync (string, number, array de user ids, fecha YMD).
 *
 * DEFENSIVAS
 *   - Todos los helpers devuelven `null` (o `[]` para arrays) cuando la
 *     propiedad no existe o el tipo no matchea. Nunca throw. El caller
 *     decide si usar un default (ej: status → 'sin_empezar') o descartar la fila.
 *   - Notion permite que la misma propiedad venga con `type` distinto entre
 *     páginas (raro, pero posible cuando se cambia el schema y no se
 *     migran pages viejos). Los helpers matchean por type esperado y
 *     rebotan al null en ese caso — matchea el comportamiento defensivo.
 */

type NotionPropertyValue = Record<string, unknown> & { type?: string };

// ═══════════════════════════════════════════════════════════════════════════
// Título — tipo `title`
// ═══════════════════════════════════════════════════════════════════════════

export function parseTitle(
  properties: Record<string, unknown>,
  propName: string,
): string | null {
  const prop = properties[propName] as NotionPropertyValue | undefined;
  if (!prop || prop.type !== "title") return null;
  const arr = (prop.title as Array<{ plain_text?: string }> | undefined) ?? [];
  const joined = arr.map((s) => s.plain_text ?? "").join("").trim();
  return joined.length > 0 ? joined : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Texto rico — tipo `rich_text` — devuelve plain text concatenado
// ═══════════════════════════════════════════════════════════════════════════

export function parseRichText(
  properties: Record<string, unknown>,
  propName: string,
): string | null {
  const prop = properties[propName] as NotionPropertyValue | undefined;
  if (!prop || prop.type !== "rich_text") return null;
  const arr =
    (prop.rich_text as Array<{ plain_text?: string }> | undefined) ?? [];
  const joined = arr.map((s) => s.plain_text ?? "").join("");
  return joined.length > 0 ? joined : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Select — tipo `select` o `status` (Notion trata "status" como select especial)
// ═══════════════════════════════════════════════════════════════════════════

export function parseSelect(
  properties: Record<string, unknown>,
  propName: string,
): string | null {
  const prop = properties[propName] as NotionPropertyValue | undefined;
  if (!prop) return null;
  return selectishValue(prop);
}

/**
 * Extrae una etiqueta de estado/prioridad de cualquier shape que Notion use
 * para representar "una opción". Cubrimos más que `select`/`status` porque
 * cada tablero arma el estado a su manera:
 *
 *   select / status  — el caso clásico.
 *   multi_select     — tableros que taggean; usamos la PRIMERA opción.
 *   formula (string) — estado derivado por fórmula.
 *   rollup           — estado heredado de una relación; miramos el primer item.
 *
 * Devuelve null si el shape no aporta una etiqueta usable.
 */
function selectishValue(prop: NotionPropertyValue, depth = 0): string | null {
  // Guard de recursión: rollup de rollup de… no debería pasar, pero el shape
  // viene de un tercero y no queremos un stack overflow por data rara.
  if (depth > 2) return null;

  if (prop.type === "select") {
    const sel = prop.select as { name?: string } | null;
    return sel?.name ?? null;
  }
  if (prop.type === "status") {
    const sel = prop.status as { name?: string } | null;
    return sel?.name ?? null;
  }
  if (prop.type === "multi_select") {
    const arr =
      (prop.multi_select as Array<{ name?: string }> | undefined) ?? [];
    return arr[0]?.name ?? null;
  }
  if (prop.type === "formula") {
    const f = prop.formula as NotionPropertyValue | null;
    if (f?.type === "string") {
      const v = f.string as string | null;
      return v && v.trim().length > 0 ? v : null;
    }
    return null;
  }
  if (prop.type === "rollup") {
    const r = prop.rollup as NotionPropertyValue | null;
    if (r?.type === "array") {
      const arr = (r.array as NotionPropertyValue[] | undefined) ?? [];
      for (const item of arr) {
        const v = selectishValue(item, depth + 1);
        if (v != null) return v;
      }
    }
    return null;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Checkbox — tipo `checkbox` (o `formula` que resuelve a checkbox)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Devuelve `true`/`false` si la propiedad es un tilde, o `null` si no existe
 * o no es un shape booleano.
 *
 * La distinción null vs false importa: `null` significa "esta database no
 * tiene ese tilde" (no tocamos el estado), `false` significa "existe y está
 * destildado" (el proyecto NO está terminado).
 */
export function parseCheckbox(
  properties: Record<string, unknown>,
  propName: string,
): boolean | null {
  const prop = properties[propName] as NotionPropertyValue | undefined;
  if (!prop) return null;
  if (prop.type === "checkbox") {
    return typeof prop.checkbox === "boolean" ? prop.checkbox : null;
  }
  if (prop.type === "formula") {
    const f = prop.formula as NotionPropertyValue | null;
    if (f?.type === "boolean" || f?.type === "checkbox") {
      const v = (f.boolean ?? f.checkbox) as unknown;
      return typeof v === "boolean" ? v : null;
    }
  }
  if (prop.type === "rollup") {
    const r = prop.rollup as NotionPropertyValue | null;
    if (r?.type === "array") {
      const arr = (r.array as NotionPropertyValue[] | undefined) ?? [];
      for (const item of arr) {
        if (item?.type === "checkbox" && typeof item.checkbox === "boolean") {
          return item.checkbox;
        }
      }
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// People — tipo `people` — devuelve array de user ids
// ═══════════════════════════════════════════════════════════════════════════

export function parsePeople(
  properties: Record<string, unknown>,
  propName: string,
): string[] {
  const prop = properties[propName] as NotionPropertyValue | undefined;
  if (!prop || prop.type !== "people") return [];
  const arr = (prop.people as Array<{ id?: string }> | undefined) ?? [];
  return arr.map((u) => u.id).filter((id): id is string => !!id);
}

// ═══════════════════════════════════════════════════════════════════════════
// Responsables — tolerante al tipo de columna
// ═══════════════════════════════════════════════════════════════════════════

export interface ParsedAssignees {
  /** Notion user ids — resolvemos contra `notion_users.notion_user_id`. */
  readonly userIds: readonly string[];
  /**
   * Etiquetas de texto (nombres, emails) para los tableros que NO usan una
   * columna `people`. El caller las resuelve contra el índice de nombres/
   * emails de `notion_users` + `organization_people`.
   */
  readonly labels: readonly string[];
}

/**
 * Lee los responsables de UNA columna, sea cual sea su tipo.
 *
 * POR QUÉ
 *   `parsePeople` solo entiende `type='people'`, así que en los tableros que
 *   anotan al responsable de otra forma el proyecto llegaba a KG sin dueños.
 *   Los shapes que vemos en la práctica:
 *
 *     people                    → ids directos (caso ideal).
 *     select / multi_select     → el nombre como opción ("Juan", "Equipo X").
 *     rich_text / title         → texto libre y/o @menciones de usuario.
 *     created_by/last_edited_by → el autor como proxy del responsable.
 *     formula (string)          → nombre derivado.
 *     rollup (array)            → responsables heredados de una relación.
 *     relation                  → NO resoluble sin una llamada extra por page;
 *                                 se ignora (queda documentado en la UI).
 *
 * Nunca tira: una columna con shape inesperado devuelve listas vacías.
 */
export function parseAssignees(
  properties: Record<string, unknown>,
  propName: string,
): ParsedAssignees {
  const prop = properties[propName] as NotionPropertyValue | undefined;
  if (!prop) return { userIds: [], labels: [] };

  const userIds: string[] = [];
  const labels: string[] = [];
  collectAssignees(prop, userIds, labels, 0);

  return {
    userIds: dedupe(userIds),
    labels: dedupe(labels.map((l) => l.trim()).filter((l) => l.length > 0)),
  };
}

function collectAssignees(
  prop: NotionPropertyValue,
  userIds: string[],
  labels: string[],
  depth: number,
): void {
  if (depth > 2) return;

  switch (prop.type) {
    case "people": {
      const arr =
        (prop.people as Array<{ id?: string; name?: string }> | undefined) ?? [];
      for (const u of arr) {
        if (u.id) userIds.push(u.id);
        // El nombre sirve de fallback cuando el user no está en notion_users
        // (ej: se sumó al workspace después del último sync de usuarios).
        if (u.name) labels.push(u.name);
      }
      return;
    }
    case "created_by":
    case "last_edited_by": {
      const u = prop[prop.type] as { id?: string; name?: string } | null;
      if (u?.id) userIds.push(u.id);
      if (u?.name) labels.push(u.name);
      return;
    }
    case "select": {
      const sel = prop.select as { name?: string } | null;
      if (sel?.name) labels.push(...splitLabels(sel.name));
      return;
    }
    case "multi_select": {
      const arr =
        (prop.multi_select as Array<{ name?: string }> | undefined) ?? [];
      for (const o of arr) if (o.name) labels.push(...splitLabels(o.name));
      return;
    }
    case "title":
    case "rich_text": {
      const arr =
        (prop[prop.type] as
          | Array<{
              type?: string;
              plain_text?: string;
              mention?: { type?: string; user?: { id?: string } };
            }>
          | undefined) ?? [];
      const plain: string[] = [];
      for (const seg of arr) {
        if (seg.mention?.type === "user" && seg.mention.user?.id) {
          userIds.push(seg.mention.user.id);
          // El plain_text de una mención es "@Nombre" — no lo tratamos como
          // label suelto, el id ya lo identifica mejor.
          continue;
        }
        if (seg.plain_text) plain.push(seg.plain_text);
      }
      labels.push(...splitLabels(plain.join("")));
      return;
    }
    case "email":
    case "phone_number":
    case "url": {
      const v = prop[prop.type] as string | null;
      if (v) labels.push(...splitLabels(v));
      return;
    }
    case "formula": {
      const f = prop.formula as NotionPropertyValue | null;
      if (f?.type === "string" && typeof f.string === "string") {
        labels.push(...splitLabels(f.string));
      }
      return;
    }
    case "rollup": {
      const r = prop.rollup as NotionPropertyValue | null;
      if (r?.type === "array") {
        const arr = (r.array as NotionPropertyValue[] | undefined) ?? [];
        for (const item of arr) {
          collectAssignees(item, userIds, labels, depth + 1);
        }
      }
      return;
    }
    default:
      // `relation`, `files`, `number`, … — nada que aportar.
      return;
  }
}

/**
 * Parte "Juan Pérez, Ana / Luis & Pedro" en nombres sueltos. Los operadores
 * escriben varios responsables en una sola celda de texto y separan con lo
 * que tengan a mano.
 */
function splitLabels(raw: string): string[] {
  return raw
    .split(/[,;/|&\n]+/)
    // Trim ANTES de sacar el arroba: los separadores dejan espacio delante
    // (" @Marta") y un `^@` sobre el string sin trimear no matchea.
    .map((s) => s.trim().replace(/^@+/, "").trim())
    .filter((s) => s.length > 0);
}

function dedupe(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// Date — tipo `date` — devuelve start en YMD (Notion serializa como YYYY-MM-DD o
// ISO 8601 completo con hora; slice a 10 chars da el YMD en ambos casos)
// ═══════════════════════════════════════════════════════════════════════════

export function parseDateStart(
  properties: Record<string, unknown>,
  propName: string,
): string | null {
  const prop = properties[propName] as NotionPropertyValue | undefined;
  if (!prop || prop.type !== "date") return null;
  const date = prop.date as { start?: string | null } | null;
  const start = date?.start;
  if (!start) return null;
  // "2024-03-15" o "2024-03-15T14:30:00.000Z". Slice(0,10) devuelve YMD.
  const ymd = start.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Resolver de status/priority KG desde valor Notion + map de traducción
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Aplica el mapa Notion→KG con auto-normalización + fallback.
 *
 * Orden de resolución:
 *   1) Match exacto en `map` (lo que el humano configuró explícito).
 *   2) Auto-match: normaliza el valor Notion (lowercase, sin tildes,
 *      espacios → "_") y si coincide con alguno de los valores KG válidos,
 *      lo usa. Motivo: como los enums KG están alineados a las etiquetas
 *      típicas de Notion (Sin empezar → sin_empezar, Alta → alta, etc.),
 *      el operador no tiene que llenar el mapping form si nombra igual.
 *   3) `fallback` — típicamente 'sin_empezar' para status, 'media' para
 *      priority. Solo se aplica si ni el map ni el auto-match resuelven.
 *
 * `allowedValues` es la lista blanca (ej: KG_STATUSES). Sin ella el
 * auto-match no puede validar. Case-insensitive contra el enum en formato
 * ya normalizado (los valores KG viven en snake_case lowercase por
 * convención del schema).
 */
export function applyValueMap<T extends string>(
  notionValue: string | null,
  map: Record<string, string>,
  fallback: T,
  allowedValues?: readonly T[],
): T {
  if (notionValue == null) return fallback;

  // 1) Map explícito.
  const mapped = map[notionValue];
  if (mapped != null) return mapped as T;

  // 2) Auto-match por normalización.
  if (allowedValues && allowedValues.length > 0) {
    const normalized = normalizeEnumLabel(notionValue);
    for (const v of allowedValues) {
      if (v === normalized) return v;
    }
  }

  // 3) Fallback.
  return fallback;
}

/**
 * Normaliza una etiqueta Notion al formato snake_case lowercase sin acentos
 * — para matchear contra enums KG (ej: "Alerta Máxima" → "alerta_maxima").
 * Exportado para tests + reutilización.
 */
export function normalizeEnumLabel(raw: string): string {
  return raw
    .normalize("NFD")
    // Strip combining diacritical marks (tildes, acentos): U+0300–U+036F.
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_");
}
