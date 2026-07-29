/**
 * Períodos temporales del dashboard Financiero. La page los resuelve desde
 * `searchParams` (?range=…) y los pasa a los filtros — 100% server-side, sin
 * estado de cliente. El RangePills es un `<Link>` que cambia la URL.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * REGLA DE ZONA HORARIA — leer antes de tocar
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Kingrow opera en Argentina y el calendario del dashboard es el argentino.
 * Todas las comparaciones "¿este row cae en este mes?" se hacen en calendario
 * `KG_TZ` (=America/Argentina/Buenos_Aires). NO por timestamp absoluto.
 *
 * Hay dos formas de columna en el schema y necesitan dos tratamientos:
 *
 *   1) Postgres `date`  → llega como "YYYY-MM-DD".  Slice del string y
 *      comparación lexicográfica. No hay TZ que perderse.
 *      Uso: `inPeriodDate` / `overlapsPeriodDate`.
 *
 *   2) Postgres `timestamptz` → llega como ISO con offset. Convertimos a
 *      calendario en KG_TZ (via `Intl.DateTimeFormat`) y comparamos como
 *      "YYYY-MM-DD".
 *      Uso: `inPeriodTs`.
 *
 * `KG_TZ` está declarado UNA sola vez acá. No re-hardcodear el string en los
 * callers — importar la constante si hace falta.
 *
 * Motivo histórico: usar `Date(y,m,d)` local + timestamps era ambiguo. En
 * AR-TZ, `Date(2026,6,1)` = 2026-07-01T03:00Z, mientras que `paid_at="2026-07-01"`
 * parseaba a 2026-07-01T00:00Z → el día 1 del mes caía fuera de su propio
 * mes. Simétricamente, `paid_at="2026-07-01"` bajo período "junio" caía dentro
 * de junio (porque period.to=2026-06-30T23:59:59-03=2026-07-01T02:59:59Z >
 * 2026-07-01T00:00Z). Doble falla de borde. Se corrigió pasando toda la
 * comparación a calendario KG_TZ, cubierta por los tests de bordes.
 */

export type PeriodKey = "mes-actual" | "mes-anterior" | "90d";

/** Única fuente de verdad de la zona horaria del sistema. */
export const KG_TZ = "America/Argentina/Buenos_Aires";

const DAYS_PER_MONTH = 30.44;

export interface Period {
  readonly key: PeriodKey;
  readonly label: string;
  /** "YYYY-MM-DD" en KG_TZ, inclusivo. */
  readonly fromYmd: string;
  /** "YYYY-MM-DD" en KG_TZ, inclusivo. */
  readonly toYmd: string;
  /** Fracción de meses en la ventana (alimenta `computeBurnRate`). */
  readonly monthsInWindow: number;
}

export const PERIOD_OPTIONS: ReadonlyArray<{
  readonly key: PeriodKey;
  readonly label: string;
}> = [
  { key: "mes-actual", label: "Mes actual" },
  { key: "mes-anterior", label: "Mes anterior" },
  { key: "90d", label: "90D" },
];

// en-CA formatea nativamente como "YYYY-MM-DD". Igualmente vamos por
// formatToParts para no depender de la forma textual entre ICU versions.
const YMD_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: KG_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const MONTH_LABEL_FMT = new Intl.DateTimeFormat("es-AR", {
  timeZone: KG_TZ,
  month: "short",
});

/** Convierte un `Date` a "YYYY-MM-DD" en KG_TZ. Nunca en TZ local. */
export function toCalendarYmd(d: Date): string {
  const parts = YMD_FMT.formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value ?? "0000";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${day}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Último día calendario del mes (y, m). Usa la propiedad estándar
 * `new Date(y, m, 0).getDate()` → día N del mes anterior. `getDate()` no
 * depende del TZ que corra Node (el objeto Date guarda el instante, pero
 * `getDate` lo lee en TZ local — como el objeto se construyó con esos mismos
 * componentes locales, el número devuelto es siempre el correcto).
 */
function lastDayOfMonth(y: number, m1: number): number {
  return new Date(y, m1, 0).getDate();
}

/** Suma N días calendario a un YMD y devuelve YMD. Usa UTC para no bailar. */
function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const base = Date.UTC(y!, m! - 1, d!);
  const shifted = new Date(base + days * 86_400_000);
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

function normalizeKey(v: string | null | undefined): PeriodKey {
  if (v === "mes-anterior" || v === "90d") return v;
  return "mes-actual";
}

/**
 * Resuelve el período pedido. `now` inyectable para tests deterministas.
 * Cualquier valor no reconocido cae al default "mes-actual".
 */
export function resolvePeriod(
  input: { readonly range?: string | null } | undefined,
  now: Date = new Date(),
): Period {
  const key = normalizeKey(input?.range);
  const nowYmd = toCalendarYmd(now);
  const [nowY, nowM, nowD] = nowYmd.split("-").map(Number) as [
    number,
    number,
    number,
  ];

  if (key === "mes-anterior") {
    const prevY = nowM === 1 ? nowY - 1 : nowY;
    const prevM = nowM === 1 ? 12 : nowM - 1;
    const fromYmd = `${prevY}-${pad2(prevM)}-01`;
    const toYmd = `${prevY}-${pad2(prevM)}-${pad2(lastDayOfMonth(prevY, prevM))}`;
    return { key, label: "Mes anterior", fromYmd, toYmd, monthsInWindow: 1 };
  }

  if (key === "90d") {
    const toYmd = nowYmd;
    const fromYmd = addDaysYmd(toYmd, -89);
    return {
      key,
      label: "Últimos 90 días",
      fromYmd,
      toYmd,
      monthsInWindow: 90 / DAYS_PER_MONTH,
    };
  }

  // Default: mes-actual (MTD) — desde día 1 en KG_TZ hasta hoy en KG_TZ.
  const fromYmd = `${nowY}-${pad2(nowM)}-01`;
  const toYmd = nowYmd;
  return {
    key: "mes-actual",
    label: "Mes actual",
    fromYmd,
    toYmd,
    monthsInWindow: nowD / DAYS_PER_MONTH,
  };
}

/**
 * Cualquier objeto con `fromYmd`/`toYmd` (Period o MonthBucket) sirve como
 * rango — matcheo estructural. Evita duplicar `inPeriod` una vez por consumer.
 */
export interface YmdRange {
  readonly fromYmd: string;
  readonly toYmd: string;
}

const YMD_RX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Columna Postgres `date`. Slice de los primeros 10 chars — el propio
 * formato "YYYY-MM-DD" es lexicográficamente ordenable. Seguro y sin TZ.
 */
export function inPeriodDate(
  value: string | null | undefined,
  range: YmdRange,
): boolean {
  if (!value) return false;
  const ymd = value.slice(0, 10);
  if (!YMD_RX.test(ymd)) return false;
  return ymd >= range.fromYmd && ymd <= range.toYmd;
}

/**
 * Columna Postgres `timestamptz`. Convertimos a calendario en KG_TZ y
 * comparamos como YMD. El instante absoluto se ignora — lo que importa es
 * "en qué día calendario de Buenos Aires cae".
 */
export function inPeriodTs(
  value: string | null | undefined,
  range: YmdRange,
): boolean {
  if (!value) return false;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return false;
  const ymd = toCalendarYmd(d);
  return ymd >= range.fromYmd && ymd <= range.toYmd;
}

/**
 * Solapamiento entre el rango de dos columnas `date` (payroll
 * period_start/period_end típicamente) y el período. Ambos slice-safe.
 */
export function overlapsPeriodDate(
  aValue: string | null | undefined,
  bValue: string | null | undefined,
  range: YmdRange,
): boolean {
  if (!aValue || !bValue) return false;
  const a = aValue.slice(0, 10);
  const b = bValue.slice(0, 10);
  if (!YMD_RX.test(a) || !YMD_RX.test(b)) return false;
  return a <= range.toYmd && b >= range.fromYmd;
}

// ═══════════════════════════════════════════════════════════════════════════
// Buckets mensuales — usados por el sparkline de 12 meses
// ═══════════════════════════════════════════════════════════════════════════

export interface MonthBucket extends YmdRange {
  readonly key: string; // "YYYY-MM"
  readonly label: string; // "jul"
}

/**
 * Últimos N meses completos + mes en curso hasta hoy. Cronológico: viejo → nuevo.
 * El último bucket se corta a `now` en KG_TZ para no dibujar futuro.
 */
export function lastMonths(n: number, now: Date = new Date()): MonthBucket[] {
  const nowYmd = toCalendarYmd(now);
  const [nowY, nowM] = nowYmd.split("-").map(Number) as [number, number, number];
  const buckets: MonthBucket[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const totalMonths = nowY * 12 + (nowM - 1) - i;
    const y = Math.floor(totalMonths / 12);
    const m = (totalMonths % 12) + 1;
    const fromYmd = `${y}-${pad2(m)}-01`;
    const lastCalendar = `${y}-${pad2(m)}-${pad2(lastDayOfMonth(y, m))}`;
    const toYmd = lastCalendar > nowYmd ? nowYmd : lastCalendar;
    const key = `${y}-${pad2(m)}`;
    // Etiqueta: mediodía UTC del día 15 — un instante que cae en el mes (y,m)
    // en cualquier TZ razonable, para que el formatter en KG_TZ emita
    // exactamente el nombre del mes correcto.
    const label = MONTH_LABEL_FMT.format(new Date(Date.UTC(y, m - 1, 15, 12)));
    buckets.push({ key, label, fromYmd, toYmd });
  }
  return buckets;
}
