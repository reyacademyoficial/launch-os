/**
 * Normalizador de payments para el contrato de `computeCommission`
 * (`@/lib/commissions/calc`). El calc exige que `collected` y `pledged` estén
 * expresados en la misma moneda; cuando `sale.currency` difiere de la moneda
 * nativa de algún payment, sumarlos crudos rompe threshold `paid_ratio` y el
 * escalado proporcional de tiers fixed (bug reportado post-migración 0106).
 *
 * Este helper convierte cada payment mixed-currency a la moneda del sale
 * usando `FxLookup.byPaymentId[id].amountUsd` como intermediario:
 *   - Sale en USD → normalizamos ARS payments a su equivalente USD (que ya
 *     vive en `amountUsd`, listo para usar).
 *   - Sale en ARS → normalizamos USD payments a ARS re-multiplicando por la
 *     tasa efectiva del sale (derivada de `sale.total_amount / totalUsd`).
 *     Esa tasa es la MISMA que se usó para calcular `totalUsd` en el server,
 *     así que "des-convertir" con ella es aritméticamente reversible sin
 *     tocar `launchArsPerUsd` desde el cliente.
 *
 * Degradación graceful: si falta `fxLookup`, si el sale no está en el
 * lookup, o si no hay tasa recuperable para un payment puntual, mantenemos
 * `amount` original y seteamos `hasMixed=true` — es peor que la conversión
 * pero mejor que romper el flujo. El caller puede usar el flag para pintar
 * un warning al lado de la comisión.
 */

import type { FxLookup } from "./sales-context";

interface SaleForNormalize {
  readonly id: string;
  readonly total_amount: number;
  readonly currency?: "ARS" | "USD" | null;
}

interface PaymentForNormalize {
  readonly id: string;
  readonly amount: number;
}

export interface NormalizedPaymentsResult {
  normalized: Array<{ amount: number }>;
  hasMixed: boolean;
}

export function normalizePaymentsForSaleCurrency(
  sale: SaleForNormalize,
  payments: ReadonlyArray<PaymentForNormalize>,
  fxLookup: FxLookup | undefined,
): NormalizedPaymentsResult {
  // Sin lookup no podemos identificar moneda de cada payment — passthrough
  // (mismo comportamiento pre-fix). Es el default para callers server-side
  // que aún no reciben fxLookup como prop.
  if (!fxLookup) {
    return {
      normalized: payments.map((p) => ({ amount: Number(p.amount) || 0 })),
      hasMixed: false,
    };
  }

  const saleEntry = fxLookup.bySaleId[sale.id];
  if (!saleEntry) {
    // Sale no cargado en el contexto FX — no podemos comparar monedas.
    return {
      normalized: payments.map((p) => ({ amount: Number(p.amount) || 0 })),
      hasMixed: false,
    };
  }

  const saleCurrency =
    saleEntry.currency ??
    (sale.currency === "ARS" || sale.currency === "USD" ? sale.currency : "ARS");
  const saleTotalUsd = saleEntry.totalUsd;
  const saleTotal = Number(sale.total_amount) || 0;

  // Tasa efectiva ARS-por-USD del sale, derivada del par
  // (total_amount ARS, totalUsd). Solo se usa cuando el sale es ARS y hay
  // que reconstruir el monto ARS de un payment USD.
  const saleArsPerUsd =
    saleCurrency === "ARS" && saleTotalUsd != null && saleTotalUsd > 0
      ? saleTotal / saleTotalUsd
      : null;

  const normalized: Array<{ amount: number }> = [];
  let hasMixed = false;

  for (const p of payments) {
    const amount = Number(p.amount) || 0;
    const entry = fxLookup.byPaymentId[p.id];
    const paymentCurrency = entry?.currency ?? saleCurrency;

    if (paymentCurrency === saleCurrency) {
      normalized.push({ amount });
      continue;
    }

    const amountUsd = entry?.amountUsd;

    if (saleCurrency === "USD") {
      // Payment ARS → USD. amountUsd ya lo tenemos pre-calculado en el server.
      if (amountUsd == null) {
        normalized.push({ amount });
        hasMixed = true;
        continue;
      }
      normalized.push({ amount: amountUsd });
      continue;
    }

    // saleCurrency === "ARS", payment USD → convertir a ARS re-usando la
    // tasa del sale. Si no hay tasa (totalUsd null o 0) degradamos.
    if (amountUsd == null || saleArsPerUsd == null) {
      normalized.push({ amount });
      hasMixed = true;
      continue;
    }
    normalized.push({ amount: amountUsd * saleArsPerUsd });
  }

  return { normalized, hasMixed };
}
