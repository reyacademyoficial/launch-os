/**
 * Scoring de candidatos para conciliar una factura con un movimiento bancario.
 *
 * Mismo criterio que `expense-matching`, pero espejado: para una factura el
 * movimiento "principal" tiene que ser una ENTRADA (kind='in'). Los egresos
 * reciben score = 0 y quedan al final del listado — visibles por si el humano
 * decide vincularlos como 'comision' u 'otro', pero nunca sugeridos como el
 * cobro principal.
 *
 * FUNCIÓN PURA — sin IO. Ordena todos los candidatos por probabilidad
 * descendente; el drawer los muestra completos y el buscador complementa.
 */

export interface InvoiceMatchInput {
  /** Monto BRUTO de la factura — el que suele coincidir con el ingreso. */
  readonly invoiceAmountGross: number;
  /** `issue_date` de la factura (YYYY-MM-DD). */
  readonly invoiceDateYmd: string;
  /** Moneda de la factura. Solo score, no filtra. */
  readonly invoiceCurrency: string;
}

export interface InvoiceMovementCandidate {
  readonly id: string;
  readonly amount: number;
  readonly occurredAt: string; // YYYY-MM-DD
  readonly currency?: string | null;
  readonly kind: "in" | "out";
}

export interface ScoredInvoiceCandidate<M extends InvoiceMovementCandidate> {
  readonly movement: M;
  /** [0..100] — 100 es coincidencia perfecta. */
  readonly score: number;
  readonly amountDiffPct: number;
  readonly daysDiff: number;
  readonly currencyMatches: boolean;
}

export function scoreInvoiceMatches<M extends InvoiceMovementCandidate>(
  input: InvoiceMatchInput,
  movements: readonly M[],
): ScoredInvoiceCandidate<M>[] {
  const results = movements.map((m) => scoreOne(input, m));
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const da = Math.abs(a.daysDiff);
    const db = Math.abs(b.daysDiff);
    if (da !== db) return da - db;
    return a.movement.id.localeCompare(b.movement.id);
  });
  return results;
}

function scoreOne<M extends InvoiceMovementCandidate>(
  input: InvoiceMatchInput,
  m: M,
): ScoredInvoiceCandidate<M> {
  const amountDiffPct = pctDiff(input.invoiceAmountGross, m.amount);
  const daysDiff = daysBetween(input.invoiceDateYmd, m.occurredAt);
  const currencyMatches = currenciesEqual(input.invoiceCurrency, m.currency);

  // Una salida no puede cobrar una factura — score = 0. Igual queda visible
  // al final para que el humano lo elija como 'comision' u 'otro'.
  if (m.kind === "out") {
    return { movement: m, score: 0, amountDiffPct, daysDiff, currencyMatches };
  }

  const amountScore = Math.max(0, 100 * (1 - Math.min(amountDiffPct, 1)));
  const dateDecayDays = 60;
  const dateScore = Math.max(
    0,
    100 * (1 - Math.min(Math.abs(daysDiff) / dateDecayDays, 1)),
  );
  const raw = amountScore * 0.65 + dateScore * 0.35;
  const score = currencyMatches ? raw : raw * 0.4;

  return { movement: m, score, amountDiffPct, daysDiff, currencyMatches };
}

function pctDiff(a: number, b: number): number {
  const denom = Math.max(Math.abs(a), Math.abs(b));
  if (denom === 0) return 0;
  return Math.abs(a - b) / denom;
}

function daysBetween(a: string, b: string): number {
  const ta = Date.parse(`${a.slice(0, 10)}T00:00:00Z`);
  const tb = Date.parse(`${b.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 0;
  return Math.round((tb - ta) / 86_400_000);
}

function currenciesEqual(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const na = (a ?? "").toUpperCase().trim();
  const nb = (b ?? "").toUpperCase().trim();
  if (!na && !nb) return true;
  return na === nb;
}
