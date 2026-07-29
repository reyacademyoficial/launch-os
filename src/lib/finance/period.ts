/**
 * Períodos temporales del dashboard Financiero. La page los resuelve desde
 * `searchParams` (?range=…) y los pasa a los filtros — 100% server-side, sin
 * estado de cliente. El RangePills es un `<Link>` que cambia la URL.
 *
 * Convenciones:
 *   - `from` inclusivo, `to` inclusivo (fin de día).
 *   - `monthsInWindow` en fracciones (mes actual día 15 → ~0.5). Alimenta
 *     `computeBurnRate({ monthsInWindow })`.
 *   - Los defaults viven acá; no re-definirlos en la page.
 */

export type PeriodKey = "mes-actual" | "mes-anterior" | "90d";

export interface Period {
  readonly key: PeriodKey;
  readonly label: string;
  readonly from: Date;
  readonly to: Date;
  readonly monthsInWindow: number;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const DAYS_PER_MONTH = 30.44;

export const PERIOD_OPTIONS: ReadonlyArray<{
  readonly key: PeriodKey;
  readonly label: string;
}> = [
  { key: "mes-actual", label: "Mes actual" },
  { key: "mes-anterior", label: "Mes anterior" },
  { key: "90d", label: "90D" },
];

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
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
  const y = now.getFullYear();
  const m = now.getMonth();

  if (key === "mes-anterior") {
    const from = startOfDay(new Date(y, m - 1, 1));
    // Día 0 del mes actual = último día del anterior.
    const to = endOfDay(new Date(y, m, 0));
    return { key, label: "Mes anterior", from, to, monthsInWindow: 1 };
  }

  if (key === "90d") {
    const to = endOfDay(now);
    const from = startOfDay(new Date(now.getTime() - 89 * MS_PER_DAY));
    return { key, label: "Últimos 90 días", from, to, monthsInWindow: 90 / DAYS_PER_MONTH };
  }

  // Default: mes-actual (MTD)
  const from = startOfDay(new Date(y, m, 1));
  const to = endOfDay(now);
  const days = Math.max(1, Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY) + 1);
  return {
    key: "mes-actual",
    label: "Mes actual",
    from,
    to,
    monthsInWindow: days / DAYS_PER_MONTH,
  };
}

function normalizeKey(v: string | null | undefined): PeriodKey {
  if (v === "mes-anterior" || v === "90d") return v;
  return "mes-actual";
}

/**
 * True si `dateStr` (ISO date o timestamp) cae dentro del período. `null` /
 * inválido → false (el ausente NO cuenta).
 */
export function inPeriod(
  dateStr: string | null | undefined,
  period: Period,
): boolean {
  if (!dateStr) return false;
  const t = new Date(dateStr).getTime();
  if (!Number.isFinite(t)) return false;
  return t >= period.from.getTime() && t <= period.to.getTime();
}

/**
 * True si el rango `[a,b]` de una fila (p.ej. payroll.period_start/end) se
 * SOLAPA con el período pedido.
 */
export function overlapsPeriod(
  aStr: string | null | undefined,
  bStr: string | null | undefined,
  period: Period,
): boolean {
  if (!aStr || !bStr) return false;
  const a = new Date(aStr).getTime();
  const b = new Date(bStr).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return a <= period.to.getTime() && b >= period.from.getTime();
}

export interface MonthBucket {
  readonly key: string;
  readonly label: string;
  readonly from: Date;
  readonly to: Date;
}

/**
 * Últimos N meses completos + mes en curso hasta hoy. El último bucket termina
 * al `to` del período actual (típicamente `now`) para no dibujar futuro.
 */
export function lastMonths(n: number, now: Date = new Date()): MonthBucket[] {
  const buckets: MonthBucket[] = [];
  const y = now.getFullYear();
  const m = now.getMonth();
  for (let i = n - 1; i >= 0; i--) {
    const from = new Date(y, m - i, 1);
    const nextFrom = new Date(y, m - i + 1, 1);
    // Cortar el último mes al día actual — no dibujar futuro.
    const rawTo = new Date(nextFrom.getTime() - 1);
    const to = rawTo.getTime() > now.getTime() ? now : rawTo;
    const key = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, "0")}`;
    const label = from.toLocaleDateString("es-AR", { month: "short" });
    buckets.push({ key, label, from, to });
  }
  return buckets;
}
