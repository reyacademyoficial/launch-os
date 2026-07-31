/**
 * Formatters de moneda. Locale es-AR (punto de miles, coma decimal) uniforme
 * con `src/lib/finance/format.ts`, pero explícitos con el símbolo:
 *
 *   fmtUsd(1234)  → "US$ 1.234"
 *   fmtArs(1234)  → "AR$ 1.234"
 *
 * El símbolo con prefijo AR$/US$ (en vez de solo $) evita ambigüedad — en
 * dashboards con montos en las dos monedas conviviendo, ver "AR$" al lado
 * de "US$" es más rápido que leer un tooltip.
 *
 * Todos aceptan null/undefined/no-finito y devuelven "—". El monto que no
 * existe no es cero — es información faltante.
 */

import type { Currency } from "./types";

const nfInt = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

type MaybeNumber = number | null | undefined;

function isMissing(n: MaybeNumber): boolean {
  return n == null || !Number.isFinite(n);
}

/** `US$ 1.234`. Enteros redondeados. */
export function fmtUsd(n: MaybeNumber): string {
  if (isMissing(n)) return "—";
  const sign = n! < 0 ? "-" : "";
  return `${sign}US$ ${nfInt.format(Math.abs(Math.round(n!)))}`;
}

/** `US$ 12,34`. Dos decimales — para CPL, ROAS, comisiones proporcionales. */
export function fmtUsdDecimals(n: MaybeNumber): string {
  if (isMissing(n)) return "—";
  const sign = n! < 0 ? "-" : "";
  return `${sign}US$ ${nf2.format(Math.abs(n!))}`;
}

/** `AR$ 1.234`. Enteros redondeados. */
export function fmtArs(n: MaybeNumber): string {
  if (isMissing(n)) return "—";
  const sign = n! < 0 ? "-" : "";
  return `${sign}AR$ ${nfInt.format(Math.abs(Math.round(n!)))}`;
}

/**
 * Elige el formatter según la moneda. Útil para la vista de bancos, donde
 * cada fila puede estar en su moneda nativa.
 */
export function fmtNative(n: MaybeNumber, currency: Currency): string {
  return currency === "USD" ? fmtUsd(n) : fmtArs(n);
}
