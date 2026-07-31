/**
 * Módulo de moneda / conversión. Punto único de entrada — el resto del repo
 * importa desde `@/lib/money`, no de los archivos internos.
 *
 * Uso típico en un aggregate server-side:
 *
 *   import {
 *     loadProjectFxRates,
 *     getLaunchRate,
 *     resolveMonthlyRateFromMap,
 *     sumInUsd,
 *     fmtUsd,
 *   } from "@/lib/money";
 *
 *   const fxMap = await loadProjectFxRates(supabase, projectId);
 *   const { total, missingCount } = sumInUsd(payments, (p) => ({
 *     native: { amount: p.amount, currency: p.bank.currency },
 *     ctx: {
 *       launchArsPerUsd: getLaunchRate(p.launch),
 *       monthlyArsPerUsd: resolveMonthlyRateFromMap(fxMap, p.paid_at),
 *     },
 *   }));
 *   return fmtUsd(total);
 */

export type { Currency, NativeAmount, FxContext, SumInUsdResult } from "./types";
export { CURRENCIES } from "./types";

export { toUsd, pickRate, sumInUsd } from "./convert";

export {
  monthKey,
  buildFxRateMap,
  resolveMonthlyRateFromMap,
  getLaunchRate,
  effectiveCurrency,
  loadProjectFxRates,
  type ProjectFxRateRow,
} from "./rates";

export { fmtUsd, fmtUsdDecimals, fmtArs, fmtNative } from "./format";
