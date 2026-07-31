/**
 * Tipos base del módulo de moneda / conversión.
 *
 * Convención del proyecto: dos monedas, ARS y USD. La "moneda de trabajo"
 * de la operación es USD — todos los dashboards agregados se muestran en
 * USD. La moneda nativa de cada cobro/movimiento se preserva para conciliar
 * con el banco físico y para el backfill idempotente.
 */

export type Currency = "ARS" | "USD";

export const CURRENCIES: readonly Currency[] = ["ARS", "USD"] as const;

/**
 * Monto acompañado de su moneda nativa. Es el "input" a cualquier función
 * de conversión — separar `amount` de `currency` evita que un caller olvide
 * chequear la moneda y sume USD con ARS en la misma numérica.
 */
export interface NativeAmount {
  amount: number;
  currency: Currency;
}

/**
 * Contexto para resolver la tasa efectiva al convertir a USD.
 *
 * Precedencia:
 *   1. `launchArsPerUsd` — cuando el monto proviene de un cobro/spend
 *      atado a un launch. Refleja el momento comercial de ese lanzamiento.
 *   2. `monthlyArsPerUsd` — fallback para movimientos que no tienen launch
 *      (bank_movements, expenses, payroll, invoices). Lee `project_fx_rates`
 *      por el mes del `occurred_at`.
 *
 * Ambos son opcionales; si el monto ya está en USD, ninguno se usa. Si el
 * monto es ARS y ambos son null, la conversión devuelve null y el caller
 * decide qué mostrar ("—", warning, u omitir).
 */
export interface FxContext {
  launchArsPerUsd?: number | null;
  monthlyArsPerUsd?: number | null;
}

/**
 * Resultado de una suma en USD con auditoría de items sin tasa.
 * `total` cuenta solo los items convertibles; `missingCount`/`missingArs`
 * exponen lo que quedó fuera para que la UI pueda avisar al operador.
 */
export interface SumInUsdResult {
  total: number;
  missingCount: number;
  /** Suma en ARS de los items que no se pudieron convertir. */
  missingArs: number;
}
