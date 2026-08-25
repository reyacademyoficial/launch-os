/**
 * Planning semanal por editor de contenido.
 *
 * Cruza dos fuentes:
 *   - `content_assets` con `editor_person_id` seteado → carga de trabajo
 *   - `editor_availability` → días disponibles por persona en el rango
 *
 * La UI de `/marketing/edicion` renderea un pivot person × iso_week con
 * dos números: assets asignados en esa semana + días disponibles. Si hay
 * assets asignados pero 0 días disponibles → warning visual.
 *
 * Semana ISO empieza en lunes (regla del proyecto — coincide con la vista
 * de calendario). El "date bucket" del asset es su `edited_at` si existe,
 * si no `created_at` — quedan agrupadas por cuándo se planificaron.
 *
 * Puro, sin efectos, sin fetch — tests colocados junto al archivo.
 */

export interface EditorAssetInput {
  readonly editorPersonId: string;
  /** yyyy-mm-dd o iso ts — se usa la parte de fecha */
  readonly bucketDate: string;
}

export interface EditorAvailabilityInput {
  readonly personId: string;
  readonly dateFrom: string; // yyyy-mm-dd
  readonly dateTo: string; // yyyy-mm-dd
  readonly available: boolean;
}

export interface EditorWeekCell {
  readonly personId: string;
  readonly isoWeek: string; // yyyy-Www (ej: 2026-W34)
  readonly weekStart: string; // yyyy-mm-dd (lunes)
  readonly weekEnd: string; // yyyy-mm-dd (domingo)
  readonly assignedAssets: number;
  readonly availableDays: number;
  readonly overloaded: boolean; // assignedAssets > 0 && availableDays === 0
}

/**
 * `since` y `until` son yyyy-mm-dd (inclusivos). La grilla de semanas cubre
 * TODOS los lunes que caen entre esas fechas (incluyendo el lunes de la
 * semana que contiene `since`). Devolvemos las celdas ordenadas por
 * (personId, weekStart).
 */
export function computeEditorLoadByWeek(
  assets: readonly EditorAssetInput[],
  availability: readonly EditorAvailabilityInput[],
  since: string,
  until: string,
  personIds: readonly string[],
): EditorWeekCell[] {
  const weekStarts = enumerateWeekStarts(since, until);
  const result: EditorWeekCell[] = [];

  const assetsByPersonWeek = new Map<string, number>();
  for (const a of assets) {
    const dayKey = takeDatePart(a.bucketDate);
    if (!dayKey) continue;
    const ws = mondayOf(dayKey);
    if (!ws) continue;
    if (ws < weekStarts[0]! || ws > weekStarts.at(-1)!) continue;
    const key = `${a.editorPersonId}::${ws}`;
    assetsByPersonWeek.set(key, (assetsByPersonWeek.get(key) ?? 0) + 1);
  }

  for (const personId of personIds) {
    for (const ws of weekStarts) {
      const weekEnd = addDaysYmd(ws, 6);
      const availableDays = countAvailableDaysInRange(
        availability.filter((a) => a.personId === personId),
        ws,
        weekEnd,
      );
      const assignedAssets =
        assetsByPersonWeek.get(`${personId}::${ws}`) ?? 0;
      result.push({
        personId,
        isoWeek: isoWeekLabel(ws),
        weekStart: ws,
        weekEnd,
        assignedAssets,
        availableDays,
        overloaded: assignedAssets > 0 && availableDays === 0,
      });
    }
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers puros (exportados para test / reuse en la UI)
// ═══════════════════════════════════════════════════════════════════════════

export function takeDatePart(s: string | null | undefined): string | null {
  if (!s) return null;
  const trimmed = s.trim();
  if (trimmed.length === 0) return null;
  // yyyy-mm-dd o yyyy-mm-ddTHH:MM…
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** Devuelve el lunes (yyyy-mm-dd) de la semana que contiene `dayYmd`. */
export function mondayOf(dayYmd: string): string | null {
  const parts = dayYmd.split("-");
  if (parts.length !== 3) return null;
  const y = Number.parseInt(parts[0]!, 10);
  const m = Number.parseInt(parts[1]!, 10);
  const d = Number.parseInt(parts[2]!, 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return null;
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(date.getTime())) return null;
  // getUTCDay: 0=domingo, 1=lunes … 6=sábado. Queremos offset a lunes.
  const dow = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dow);
  return toYmdUTC(date);
}

/** Devuelve todos los lunes (yyyy-mm-dd) entre las semanas de `since` y `until`. */
export function enumerateWeekStarts(since: string, until: string): string[] {
  const first = mondayOf(since);
  const last = mondayOf(until);
  if (!first || !last) return [];
  const out: string[] = [];
  let cursor = first;
  while (cursor <= last) {
    out.push(cursor);
    cursor = addDaysYmd(cursor, 7);
  }
  return out;
}

export function addDaysYmd(ymd: string, delta: number): string {
  const parts = ymd.split("-");
  const y = Number.parseInt(parts[0] ?? "", 10);
  const m = Number.parseInt(parts[1] ?? "", 10);
  const d = Number.parseInt(parts[2] ?? "", 10);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + delta);
  return toYmdUTC(date);
}

function toYmdUTC(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Cuenta días marcados como disponibles en [rangeStart, rangeEnd] (inclusivo)
 * resolviendo overrides: si un mismo día está cubierto por dos rows con
 * distinto `available`, gana el rango MÁS ESPECÍFICO (menor cantidad de días).
 * Es una heurística: la interpretación es "una licencia de 3 días sobrescribe
 * la disponibilidad general de un mes entero".
 */
export function countAvailableDaysInRange(
  rows: readonly EditorAvailabilityInput[],
  rangeStart: string,
  rangeEnd: string,
): number {
  const start = rangeStart;
  const end = rangeEnd;
  if (end < start) return 0;

  // Ordenar de menos específico (rango grande) a más específico (rango
  // chico) para que los overrides queden al final y ganen.
  const sorted = [...rows].sort((a, b) => rangeLen(b) - rangeLen(a));

  const days = enumerateDays(start, end);
  const dayMap = new Map<string, boolean>();
  for (const row of sorted) {
    const rowStart = row.dateFrom > start ? row.dateFrom : start;
    const rowEnd = row.dateTo < end ? row.dateTo : end;
    if (rowEnd < rowStart) continue;
    for (const d of enumerateDays(rowStart, rowEnd)) {
      dayMap.set(d, row.available);
    }
  }

  let count = 0;
  for (const d of days) {
    if (dayMap.get(d) === true) count += 1;
  }
  return count;
}

function rangeLen(row: EditorAvailabilityInput): number {
  const parts1 = row.dateFrom.split("-");
  const parts2 = row.dateTo.split("-");
  const a = Date.UTC(
    Number.parseInt(parts1[0] ?? "", 10),
    Number.parseInt(parts1[1] ?? "", 10) - 1,
    Number.parseInt(parts1[2] ?? "", 10),
  );
  const b = Date.UTC(
    Number.parseInt(parts2[0] ?? "", 10),
    Number.parseInt(parts2[1] ?? "", 10) - 1,
    Number.parseInt(parts2[2] ?? "", 10),
  );
  return (b - a) / (24 * 60 * 60 * 1000);
}

function enumerateDays(fromYmd: string, toYmd: string): string[] {
  const out: string[] = [];
  let cursor = fromYmd;
  while (cursor <= toYmd) {
    out.push(cursor);
    cursor = addDaysYmd(cursor, 1);
  }
  return out;
}

/**
 * Etiqueta ISO week (yyyy-Www) del lunes dado. La ISO week num se calcula
 * segun ISO 8601: la semana que contiene el jueves define el año/semana.
 */
export function isoWeekLabel(mondayYmd: string): string {
  const parts = mondayYmd.split("-");
  const y = Number.parseInt(parts[0] ?? "", 10);
  const m = Number.parseInt(parts[1] ?? "", 10);
  const d = Number.parseInt(parts[2] ?? "", 10);
  const date = new Date(Date.UTC(y, m - 1, d));
  // Jueves de la semana ISO (lunes + 3).
  const thu = new Date(date);
  thu.setUTCDate(thu.getUTCDate() + 3);
  const isoYear = thu.getUTCFullYear();
  // Primer jueves del año ISO.
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4Dow = (jan4.getUTCDay() + 6) % 7;
  const firstMonday = new Date(jan4);
  firstMonday.setUTCDate(jan4.getUTCDate() - jan4Dow);
  const weekNum =
    Math.floor((date.getTime() - firstMonday.getTime()) / (7 * 24 * 3600 * 1000)) +
    1;
  return `${isoYear}-W${String(weekNum).padStart(2, "0")}`;
}
