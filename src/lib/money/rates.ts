/**
 * Resolvers de tasa. Split en dos capas:
 *
 *   1. Funciones puras (`resolveMonthlyRateFromMap`, `effectiveCurrency`,
 *      `getLaunchRate`) — reciben data ya cargada, sin async. Se usan dentro
 *      de aggregate loops donde no querés hacer un query por item.
 *
 *   2. Loader async (`loadProjectFxRates`) — hace UN query a `project_fx_rates`
 *      del proyecto entero y devuelve un Map keyed por "YYYY-MM". El caller
 *      lo pre-carga una vez y usa las funciones puras arriba.
 *
 * Este split evita N+1 (nunca un query por payment/movement) y mantiene la
 * lógica testeable — mock el Map, no la DB.
 */

import type { Currency } from "./types";

/**
 * Row de `project_fx_rates`. `month` viene como YYYY-MM-DD (día 1 del mes,
 * enforced por CHECK en la migración 0103).
 */
export interface ProjectFxRateRow {
  month: string;
  ars_per_usd: number;
}

/**
 * Extrae la key mensual "YYYY-MM" de una fecha. Acepta:
 *   - string YYYY-MM-DD (columna DATE de Postgres, sin timezone)
 *   - string ISO timestamptz
 *   - Date
 *
 * Para YYYY-MM-DD parseamos manualmente para evitar el shift de timezone
 * que produce `new Date("2026-07-15")` en zonas UTC- (ver `parseDate` en
 * `src/lib/launches/calendar.ts` para el mismo issue).
 */
export function monthKey(occurredAt: Date | string): string {
  if (typeof occurredAt === "string") {
    const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(occurredAt);
    if (m) return `${m[1]}-${m[2]}`;
  }
  const d = occurredAt instanceof Date ? occurredAt : new Date(occurredAt);
  const y = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${mm}`;
}

/**
 * Arma el Map keyed por "YYYY-MM" a partir de las rows crudas. Función pura
 * para poder testear sin DB. Rows con el mismo mes (imposible por el UNIQUE
 * de la migración, pero defensivo) mantienen la última.
 */
export function buildFxRateMap(
  rows: readonly ProjectFxRateRow[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of rows) {
    if (!Number.isFinite(r.ars_per_usd) || r.ars_per_usd <= 0) continue;
    map.set(monthKey(r.month), r.ars_per_usd);
  }
  return map;
}

/**
 * Busca la tasa mensual del proyecto para la fecha dada. Devuelve `null` si
 * no hay tasa cargada para ese mes — el caller decide fallback (mostrar
 * warning, omitir del total, usar la tasa del mes anterior más cercano si
 * decidiéramos esa política en el futuro).
 *
 * Por ahora: match exacto por mes, sin fallback silencioso a mes anterior.
 * Un movimiento sin tasa se muestra explícitamente para que el operador
 * cargue la tasa.
 */
export function resolveMonthlyRateFromMap(
  rates: Map<string, number>,
  occurredAt: Date | string,
): number | null {
  return rates.get(monthKey(occurredAt)) ?? null;
}

/**
 * Devuelve la tasa del launch (o null si no está seteada). Trivial pero
 * centraliza la lectura para que si mañana cambia el shape (por ejemplo,
 * migramos a tasa por-fecha dentro del launch) solo se toca acá.
 */
export function getLaunchRate(launch: {
  ars_per_usd?: number | null;
}): number | null {
  const v = launch.ars_per_usd;
  if (v == null || !Number.isFinite(v) || v <= 0) return null;
  return v;
}

/**
 * Devuelve la tasa efectiva del launch con fallback a la tasa mensual.
 *
 * Regla: `launch.ars_per_usd` → tasa mensual del mes anchor
 * (`date_end ?? date_start ?? hoy`) → null.
 *
 * El anchor es el mes del launch — no el mes de cada cobro — porque este
 * helper se usa para valores agregados sin fecha propia (revenue manual,
 * inversión de ads cuando `ads_currency='ARS'`). Los pagos individuales
 * SÍ deben usar `resolveMonthlyRateFromMap(paid_at)` vía `SalesFxContext`.
 */
export function resolveLaunchFallbackRate(
  launch: {
    ars_per_usd?: number | null;
    date_end?: string | null;
    date_start?: string | null;
  },
  fxMap: Map<string, number>,
): number | null {
  const own = getLaunchRate(launch);
  if (own !== null) return own;
  const anchor = launch.date_end ?? launch.date_start ?? new Date();
  return resolveMonthlyRateFromMap(fxMap, anchor);
}

/**
 * Resuelve la moneda efectiva de un método de pago. Regla:
 *   - Si el método tiene banco → moneda del banco (fuente de verdad).
 *   - Si no tiene banco → `method.currency` (efectivo, otros).
 *
 * Fallback defensivo a "ARS" si ambos son null — no debería pasar si la UI
 * valida "currency requerido cuando bank_id IS NULL", pero mejor no romper
 * el render por un método viejo sin backfill.
 */
export function effectiveCurrency(
  method: { currency?: Currency | null } | null,
  bank: { currency?: Currency | null } | null,
): Currency {
  if (bank?.currency === "ARS" || bank?.currency === "USD") return bank.currency;
  if (method?.currency === "ARS" || method?.currency === "USD") {
    return method.currency;
  }
  return "ARS";
}

// ═══════════════════════════════════════════════════════════════════════════
// Loader async — usa un cliente Supabase inyectado (RLS-aware)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Cliente supabase genérico. Uso el mismo shape laxo que `sync.ts` para no
 * atarme al tipo estricto de `SupabaseClient` — las tablas nuevas todavía
 * no están en el Database type generado.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
type LooseClient = {
  from: (name: string) => any;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Carga todas las tasas mensuales del proyecto en un solo query y devuelve
 * el Map listo para consulta. Barato: `project_fx_rates` es una tabla chica
 * (12 rows/año × pocos años) — no hace falta paginar ni filtrar por rango.
 */
export async function loadProjectFxRates(
  supabase: LooseClient,
  projectId: string,
): Promise<Map<string, number>> {
  const res = await supabase
    .from("project_fx_rates")
    .select("month, ars_per_usd")
    .eq("project_id", projectId);
  const rows = (res.data ?? []) as ProjectFxRateRow[];
  return buildFxRateMap(rows);
}

/**
 * Devuelve la tasa ARS/USD más reciente disponible a nivel org (sin filtrar
 * por proyecto). Útil para vistas org-scope (bancos) donde no hay un único
 * proyecto de referencia. Devuelve null si no hay ninguna tasa cargada.
 */
export async function loadLatestOrgFxRate(
  supabase: LooseClient,
): Promise<{ rate: number; month: string } | null> {
  const res = await supabase
    .from("project_fx_rates")
    .select("month, ars_per_usd")
    .order("month", { ascending: false })
    .limit(1);
  const row = ((res.data ?? []) as ProjectFxRateRow[])[0];
  if (!row || !Number.isFinite(row.ars_per_usd) || row.ars_per_usd <= 0) {
    return null;
  }
  return { rate: row.ars_per_usd, month: monthKey(row.month) };
}

/**
 * Devuelve un Map keyed por "YYYY-MM" con la tasa más reciente de ese mes
 * a nivel org (agregando entre proyectos). Uso: convertir gastos/nómina
 * org-scope (sin `project_id`) usando la tasa del mes de devengo en vez de
 * una única tasa global — mucho más justo para períodos largos donde la
 * tasa varía.
 *
 * Si el mismo mes tiene tasas de proyectos distintos, se queda con la
 * ÚLTIMA que aparece en el orden ascendente por mes — postgrest no
 * garantiza tiebreak. Es aceptable: las tasas mensuales son prácticamente
 * iguales entre proyectos porque las carga la misma persona con la misma
 * referencia. Si en algún caso divergen, ver `resolveMonthlyRateFromMap`
 * con el `project_id` específico.
 */
export async function loadOrgFxRatesByMonth(
  supabase: LooseClient,
): Promise<Map<string, number>> {
  const res = await supabase
    .from("project_fx_rates")
    .select("month, ars_per_usd")
    .order("month", { ascending: true });
  const rows = (res.data ?? []) as ProjectFxRateRow[];
  const map = new Map<string, number>();
  for (const r of rows) {
    if (!Number.isFinite(r.ars_per_usd) || r.ars_per_usd <= 0) continue;
    map.set(monthKey(r.month), r.ars_per_usd);
  }
  return map;
}
