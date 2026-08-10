/**
 * Formatters para el módulo Financiero. Locale rioplatense (es-AR) — punto de
 * miles, coma decimal. Todos aceptan `null`/`undefined`/no-finito y devuelven
 * `"—"` (em-dash) porque el número que no existe NO es cero.
 */

const nfInt = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });

type MaybeNumber = number | null | undefined;

function isMissing(n: MaybeNumber): boolean {
  return n == null || !Number.isFinite(n);
}

/** `$1.234.567`. Enteros redondeados. */
export function fMoney(n: MaybeNumber): string {
  if (isMissing(n)) return "—";
  const sign = n! < 0 ? "-" : "";
  return `${sign}$${nfInt.format(Math.abs(Math.round(n!)))}`;
}

/**
 * Compacto: `$1,2M` / `$450K`. Para HeroKpi/SupportKpi donde el ancho manda.
 * Umbrales: ≥1B, ≥1M, ≥1K; menor cae a `$` con enteros.
 */
export function fMoneyK(n: MaybeNumber): string {
  if (isMissing(n)) return "—";
  const abs = Math.abs(n!);
  const sign = n! < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}$${nf1.format(abs / 1_000_000_000)}B`;
  if (abs >= 1_000_000) return `${sign}$${nf1.format(abs / 1_000_000)}M`;
  if (abs >= 1_000) return `${sign}$${nf1.format(abs / 1_000)}K`;
  return `${sign}$${nfInt.format(abs)}`;
}

/** `85,3%`. Entrada en [0,1]. */
export function fPct(n: MaybeNumber): string {
  if (isMissing(n)) return "—";
  return `${nf1.format(n! * 100)}%`;
}

/**
 * Runway: `null` → `"∞"` (no hay burn), no-finito → `"—"`, `≥24` → años.
 * En meses caso base.
 */
export function fMonths(n: MaybeNumber): string {
  if (n === null) return "∞";
  if (isMissing(n)) return "—";
  if (n! <= 0) return "0 meses";
  if (n! >= 24) return `${nf1.format(n! / 12)} años`;
  return `${nf1.format(n!)} meses`;
}

/** Enteros de conteo. */
export function fCount(n: MaybeNumber): string {
  if (isMissing(n)) return "—";
  return nfInt.format(n!);
}

/**
 * Fecha ISO/Date → `29 jul` (día + mes corto, es-AR). Para `sub` de HeroKpi
 * y feeds. Nunca año — es contexto reciente.
 */
export function fDateShort(d: Date | string | null | undefined): string {
  if (d == null) return "—";
  const date = d instanceof Date ? d : new Date(typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T12:00:00Z` : d as string);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleDateString("es-AR", { day: "numeric", month: "short" });
}
