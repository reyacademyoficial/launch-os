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
  if (prop.type === "select") {
    const sel = prop.select as { name?: string } | null;
    return sel?.name ?? null;
  }
  if (prop.type === "status") {
    const sel = prop.status as { name?: string } | null;
    return sel?.name ?? null;
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
