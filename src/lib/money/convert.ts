/**
 * Funciones puras de conversión ARS → USD.
 *
 * Sin side effects, sin DB. Todas las tasas se pasan por parámetro. Los
 * resolvers async que leen `launches.ars_per_usd` y `project_fx_rates` viven
 * en `./rates.ts` — se separan para que estas funciones se puedan testear
 * con datos crudos y usar dentro de un aggregate loop sin async por item.
 */

import type { FxContext, NativeAmount, SumInUsdResult } from "./types";

/**
 * Convierte un monto a USD dividiendo por la tasa efectiva del contexto.
 *
 * Reglas:
 *  - `currency === "USD"` → devuelve `amount` sin tocar (aunque haya tasas).
 *  - `currency === "ARS"` con `launchArsPerUsd` > 0 → `amount / launchArsPerUsd`.
 *  - `currency === "ARS"` con `monthlyArsPerUsd` > 0 (y sin launch) → idem.
 *  - `currency === "ARS"` sin ninguna tasa válida → `null`.
 *
 * Devolver `null` en vez de tirar o devolver 0 es intencional: el caller
 * decide si mostrar "—", loguear un warning, o excluir el item del total.
 * Sumar 0 silenciosamente enmascara datos faltantes.
 */
export function toUsd(native: NativeAmount, ctx: FxContext): number | null {
  if (native.currency === "USD") return native.amount;

  const rate = pickRate(ctx);
  if (rate === null) return null;
  return native.amount / rate;
}

/**
 * Elige la tasa efectiva del contexto. Launch > mensual. Ignora tasas ≤ 0
 * defensivamente (el CHECK del DB ya las bloquea pero un helper puro no
 * debe asumir que la data está limpia).
 */
export function pickRate(ctx: FxContext): number | null {
  if (
    ctx.launchArsPerUsd != null &&
    Number.isFinite(ctx.launchArsPerUsd) &&
    ctx.launchArsPerUsd > 0
  ) {
    return ctx.launchArsPerUsd;
  }
  if (
    ctx.monthlyArsPerUsd != null &&
    Number.isFinite(ctx.monthlyArsPerUsd) &&
    ctx.monthlyArsPerUsd > 0
  ) {
    return ctx.monthlyArsPerUsd;
  }
  return null;
}

/**
 * Suma una lista convirtiendo cada item a USD. Los items sin tasa se
 * omiten del total y se cuentan aparte en `missingCount`/`missingArs` para
 * que el caller pueda advertir al operador ("faltan tasas para 3 pagos por
 * $450.000 ARS").
 *
 * El `extract` es una lambda para no acoplar el helper a un shape específico
 * — sirve tanto para payments (native = {amount, currency del banco}) como
 * para invoices, expenses, bank_movements.
 */
export function sumInUsd<T>(
  items: readonly T[],
  extract: (x: T) => { native: NativeAmount; ctx: FxContext },
): SumInUsdResult {
  let total = 0;
  let missingCount = 0;
  let missingArs = 0;
  for (const item of items) {
    const { native, ctx } = extract(item);
    const usd = toUsd(native, ctx);
    if (usd === null) {
      missingCount++;
      if (native.currency === "ARS") missingArs += native.amount;
      continue;
    }
    total += usd;
  }
  return { total, missingCount, missingArs };
}
