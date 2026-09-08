/**
 * Planning semanal por editor de contenido.
 *
 * Cruza dos fuentes:
 *   - `content_assets` con `editor_person_id` seteado → carga de trabajo
 *   - `editor_availability` → días disponibles por persona en el rango
 *
 * La UI de `/marketing/edicion` renderea un pivot person × iso_week con
 * dos números: assets en esa semana (pendientes / total) + días disponibles.
 * Si hay trabajo pendiente y 0 días disponibles → warning visual.
 *
 * Semana ISO empieza en lunes (regla del proyecto — coincide con la vista
 * de calendario).
 *
 * El "date bucket" del asset es su **fecha objetivo de edición**
 * (`edit_due_date`, 0175): para cuándo tiene que estar listo. Ése es el
 * único dato que hace del pivot una planificación y no un histórico. Los
 * assets sin fecha objetivo devuelven `bucketDate = null` y quedan fuera de
 * la grilla — se cuentan aparte con `countUndatedByPerson` para que la UI
 * los muestre como "sin fecha" en vez de esconderlos.
 *
 * Puro, sin efectos, sin fetch — tests colocados junto al archivo.
 */

export interface EditorAssetInput {
  readonly editorPersonId: string;
  /** yyyy-mm-dd o iso ts — se usa la parte de fecha. `null` = sin fecha objetivo. */
  readonly bucketDate: string | null;
  /** `true` cuando el asset ya se marcó editado. Default: pendiente. */
  readonly edited?: boolean;
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
  /** Subconjunto de `assignedAssets` que todavía no se marcó editado. */
  readonly pendingAssets: number;
  readonly availableDays: number;
  readonly overloaded: boolean; // pendingAssets > 0 && availableDays === 0
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

  if (weekStarts.length === 0) return result;

  const assignedByPersonWeek = new Map<string, number>();
  const pendingByPersonWeek = new Map<string, number>();
  for (const a of assets) {
    const dayKey = takeDatePart(a.bucketDate);
    if (!dayKey) continue;
    const ws = mondayOf(dayKey);
    if (!ws) continue;
    if (ws < weekStarts[0]! || ws > weekStarts.at(-1)!) continue;
    const key = `${a.editorPersonId}::${ws}`;
    assignedByPersonWeek.set(key, (assignedByPersonWeek.get(key) ?? 0) + 1);
    if (a.edited !== true) {
      pendingByPersonWeek.set(key, (pendingByPersonWeek.get(key) ?? 0) + 1);
    }
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
        assignedByPersonWeek.get(`${personId}::${ws}`) ?? 0;
      const pendingAssets = pendingByPersonWeek.get(`${personId}::${ws}`) ?? 0;
      result.push({
        personId,
        isoWeek: isoWeekLabel(ws),
        weekStart: ws,
        weekEnd,
        assignedAssets,
        pendingAssets,
        availableDays,
        // Sólo el trabajo pendiente satura: 5 assets ya editados en una
        // semana de licencia no es una sobrecarga, es historia.
        overloaded: pendingAssets > 0 && availableDays === 0,
      });
    }
  }

  return result;
}

/**
 * Assets con editor asignado pero SIN fecha objetivo de edición, por persona.
 * No entran en ninguna columna del pivot, así que la UI los muestra en una
 * columna "Sin fecha" — si quedaran ocultos, el planning mentiría sobre la
 * carga real del editor.
 */
export function countUndatedByPerson(
  assets: readonly EditorAssetInput[],
  personIds: readonly string[],
): Map<string, { assignedAssets: number; pendingAssets: number }> {
  const known = new Set(personIds);
  const out = new Map<string, { assignedAssets: number; pendingAssets: number }>();
  for (const personId of personIds) {
    out.set(personId, { assignedAssets: 0, pendingAssets: 0 });
  }
  for (const a of assets) {
    if (takeDatePart(a.bucketDate) != null) continue;
    if (!known.has(a.editorPersonId)) continue;
    const entry = out.get(a.editorPersonId)!;
    out.set(a.editorPersonId, {
      assignedAssets: entry.assignedAssets + 1,
      pendingAssets: entry.pendingAssets + (a.edited === true ? 0 : 1),
    });
  }
  return out;
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

// ═══════════════════════════════════════════════════════════════════════════
// Capacidad diaria por editor (día por día, no por semana).
//
// Cruza CUATRO fuentes:
//   - `editor_weekly_schedule` (0189) → qué días de la semana trabaja el
//     editor (regla general).
//   - `editor_availability` (0164) → excepciones puntuales (licencia,
//     vacaciones) que PISAN la regla general para un rango de fechas.
//   - `editor_format_capacity` (0190) → cuántas piezas de cada formato entran
//     en un día completo — el tope es ALTERNATIVO por formato, no acumulable
//     ("6 reels O 10 nuggets O 1 podcast", no los tres juntos), así que cada
//     edición pendiente de formato X consume `1/maxPerDay[X]` del día.
//   - `content_edits` pendientes (con `dueDate` + `targetFormat`) → la carga.
//
// Un día está "sobrecargado" si:
//   - no está en el horario semanal (ni cubierto por una excepción que lo
//     habilite) y de todos modos tiene trabajo pendiente ese día, o
//   - está disponible pero la fracción usada llega a 1.0 (el día se llena).
//
// Ediciones sin `targetFormat` conocido (o sin capacidad configurada para
// ese formato) NO suman a la fracción — se cuentan aparte
// (`unknownFormatCount`) para que la UI avise "esto no se está considerando"
// en vez de fingir que no existen.
// ═══════════════════════════════════════════════════════════════════════════

export interface EditorWeeklyScheduleInput {
  readonly personId: string;
  /** ISO: 1=lunes … 7=domingo. */
  readonly dayOfWeek: number;
}

export interface EditorFormatCapacityInput {
  readonly personId: string;
  readonly format: string;
  readonly maxPerDay: number;
}

export interface EditorPendingEditInput {
  readonly editorPersonId: string;
  /** yyyy-mm-dd o iso ts — se usa la parte de fecha. `null` = sin fecha objetivo. */
  readonly dueDate: string | null;
  readonly targetFormat: string | null;
  /** `true` cuando la edición ya se cerró. Default: pendiente. */
  readonly completed?: boolean;
}

export interface EditorDayCapacity {
  readonly personId: string;
  readonly date: string; // yyyy-mm-dd
  /** ISO: 1=lunes … 7=domingo. */
  readonly dayOfWeek: number;
  readonly available: boolean;
  /** Suma de 1/maxPerDay de las ediciones pendientes con formato conocido. */
  readonly usedFraction: number;
  /** Ediciones pendientes ese día sin formato o sin capacidad configurada — no entran en `usedFraction`. */
  readonly unknownFormatCount: number;
  readonly overloaded: boolean;
}

/** yyyy-mm-dd → día ISO (1=lunes … 7=domingo). */
export function isoWeekdayOf(dayYmd: string): number {
  const parts = dayYmd.split("-");
  const y = Number.parseInt(parts[0] ?? "", 10);
  const m = Number.parseInt(parts[1] ?? "", 10);
  const d = Number.parseInt(parts[2] ?? "", 10);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow0 = date.getUTCDay(); // 0=domingo … 6=sábado
  return dow0 === 0 ? 7 : dow0;
}

/**
 * Resuelve si un día puntual está disponible según las excepciones de
 * `editor_availability` que lo cubren — mismo criterio "rango más
 * específico gana" que `countAvailableDaysInRange`. Devuelve `null` si
 * ninguna excepción cubre ese día (no hay override, manda el horario
 * semanal).
 */
function resolveExceptionForDay(
  rows: readonly EditorAvailabilityInput[],
  day: string,
): boolean | null {
  const covering = rows.filter((r) => r.dateFrom <= day && day <= r.dateTo);
  if (covering.length === 0) return null;
  // Más específico = rango más chico.
  covering.sort((a, b) => rangeLen(a) - rangeLen(b));
  return covering[0]!.available;
}

/**
 * `since`/`until` yyyy-mm-dd inclusivos. Devuelve una fila por (persona, día)
 * en ese rango, ordenadas por (personId, date).
 */
export function computeEditorCapacityByDay(
  edits: readonly EditorPendingEditInput[],
  weeklySchedule: readonly EditorWeeklyScheduleInput[],
  availabilityExceptions: readonly EditorAvailabilityInput[],
  formatCapacities: readonly EditorFormatCapacityInput[],
  since: string,
  until: string,
  personIds: readonly string[],
): EditorDayCapacity[] {
  const days = enumerateDays(since, until);
  if (days.length === 0) return [];

  // Sumar N veces 1/N en floating point puede quedar a 1e-16 de 1.0 (ej.
  // 6×(1/6)=0.9999999999999999) — sin tolerancia, "llenar exactamente el
  // día" nunca marcaría sobrecarga.
  const FULL_DAY_EPSILON = 1e-9;

  const scheduledDaysByPerson = new Map<string, Set<number>>();
  for (const s of weeklySchedule) {
    const set = scheduledDaysByPerson.get(s.personId) ?? new Set<number>();
    set.add(s.dayOfWeek);
    scheduledDaysByPerson.set(s.personId, set);
  }

  const maxPerDayByPersonFormat = new Map<string, number>();
  for (const c of formatCapacities) {
    maxPerDayByPersonFormat.set(`${c.personId}::${c.format}`, c.maxPerDay);
  }

  // Ediciones pendientes agrupadas por (persona, día).
  const editsByPersonDay = new Map<string, EditorPendingEditInput[]>();
  for (const e of edits) {
    if (e.completed === true) continue;
    const dayKey = takeDatePart(e.dueDate);
    if (!dayKey) continue;
    const key = `${e.editorPersonId}::${dayKey}`;
    const arr = editsByPersonDay.get(key) ?? [];
    arr.push(e);
    editsByPersonDay.set(key, arr);
  }

  const result: EditorDayCapacity[] = [];
  for (const personId of personIds) {
    const exceptionsForPerson = availabilityExceptions.filter(
      (a) => a.personId === personId,
    );
    const scheduledDays = scheduledDaysByPerson.get(personId) ?? new Set<number>();

    for (const day of days) {
      const dayOfWeek = isoWeekdayOf(day);
      const exception = resolveExceptionForDay(exceptionsForPerson, day);
      const available = exception ?? scheduledDays.has(dayOfWeek);

      const dayEdits = editsByPersonDay.get(`${personId}::${day}`) ?? [];
      let usedFraction = 0;
      let unknownFormatCount = 0;
      for (const e of dayEdits) {
        const maxPerDay = e.targetFormat
          ? maxPerDayByPersonFormat.get(`${personId}::${e.targetFormat}`)
          : undefined;
        if (maxPerDay != null && maxPerDay > 0) {
          usedFraction += 1 / maxPerDay;
        } else {
          unknownFormatCount += 1;
        }
      }

      result.push({
        personId,
        date: day,
        dayOfWeek,
        available,
        usedFraction,
        unknownFormatCount,
        overloaded:
          usedFraction > 0 && (!available || usedFraction >= 1 - FULL_DAY_EPSILON),
      });
    }
  }

  return result;
}
