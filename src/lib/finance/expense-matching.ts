/**
 * Scoring de candidatos para vincular un gasto con un movimiento bancario.
 *
 * REGLA DE ORO: ordenar, NO filtrar.
 *
 * La primera versión de este helper filtraba movimientos por ±5% de monto y
 * ±14 días de fecha. Se descartó (feedback 6c-write): esconder candidatos
 * hace que el humano no encuentre el movimiento correcto cuando la
 * coincidencia no es limpia — un pago con 20 días de diferencia, uno que
 * incluye un recargo, uno que pagó dos gastos y por eso el monto no cuadra
 * con ninguno. Y el estado vacío empuja al humano a "cargá el movimiento
 * primero", produciendo exactamente el duplicado que este flujo viene a
 * evitar.
 *
 * Este scorer devuelve TODOS los candidatos, ordenados por probabilidad
 * descendente. Un candidato con exact monto + mismo día tiene score 100;
 * uno con monto muy distinto y semanas de diferencia score cercano a 0.
 * El drawer los muestra todos; el buscador en el drawer complementa esto
 * para casos donde la descripción es la mejor pista.
 *
 * FUNCIÓN PURA — sin IO, sin fechas dinámicas. El caller pasa las rows y la
 * fecha del expense; recibe la misma lista ordenada. Testeable directo.
 */

export interface ExpenseMatchInput {
  /** Monto BRUTO del gasto. Es el que suele coincidir con la salida bancaria. */
  readonly expenseAmountGross: number;
  /** `expense_date` del gasto (YYYY-MM-DD). */
  readonly expenseDateYmd: string;
  /** Moneda del gasto. Usado solo para el score de coincidencia, no filtra. */
  readonly expenseCurrency: string;
}

export interface MovementCandidate {
  readonly id: string;
  readonly amount: number;
  readonly occurredAt: string; // YYYY-MM-DD
  readonly currency?: string | null;
  /** Kind del bank_movement — 'in' descarta score de match (no puede pagar un gasto). */
  readonly kind: "in" | "out";
}

export interface ScoredCandidate<M extends MovementCandidate> {
  readonly movement: M;
  /** [0..100] — 100 es coincidencia perfecta. */
  readonly score: number;
  /** Diferencia porcentual absoluta de monto (0 = igual, 1 = 100%). */
  readonly amountDiffPct: number;
  /** Diferencia en días calendario (positivo = movimiento posterior al gasto). */
  readonly daysDiff: number;
  /** Moneda coincide con la del gasto (o ambas ausentes/null). */
  readonly currencyMatches: boolean;
}

/**
 * Devuelve TODOS los `movements` ordenados por score descendente. NO filtra.
 * El caller decide qué mostrar (típicamente: los top-N arriba y un buscador
 * para acceder al resto).
 *
 * Movements con `kind='in'` reciben score = 0 (una entrada bancaria no puede
 * pagar un gasto, es un ingreso). Aparecen igual al final del listado por si
 * el humano quiere verlos — pero nunca arriba.
 */
export function scoreExpenseMatches<M extends MovementCandidate>(
  input: ExpenseMatchInput,
  movements: readonly M[],
): ScoredCandidate<M>[] {
  const results = movements.map((m) => scoreOne(input, m));
  // Orden estable por score desc; empate por menor daysDiff absoluto; empate
  // final por id lexicográfico (determinismo en tests).
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const da = Math.abs(a.daysDiff);
    const db = Math.abs(b.daysDiff);
    if (da !== db) return da - db;
    return a.movement.id.localeCompare(b.movement.id);
  });
  return results;
}

function scoreOne<M extends MovementCandidate>(
  input: ExpenseMatchInput,
  m: M,
): ScoredCandidate<M> {
  const amountDiffPct = pctDiff(input.expenseAmountGross, m.amount);
  const daysDiff = daysBetween(input.expenseDateYmd, m.occurredAt);
  const currencyMatches = currenciesEqual(input.expenseCurrency, m.currency);

  // Score = 0 si es 'in' — un ingreso no puede pagar un gasto. La fila
  // aparece al final del listado igual, para que el humano decida.
  if (m.kind === "in") {
    return { movement: m, score: 0, amountDiffPct, daysDiff, currencyMatches };
  }

  // Componentes del score:
  //  - amountScore: 100 si monto exacto, 0 si difiere >=100%. Decae lineal
  //    para que "un 10% de diferencia" (recargo típico) siga siendo alto.
  //  - dateScore: 100 si mismo día, decae hasta 0 a 60 días. Ventana amplia
  //    a propósito: el punto es NO filtrar; el orden es sugerencia.
  //  - currencyPenalty: si difieren, aplicamos un factor 0.4. No cero —
  //    puede ser dato mal cargado y queremos que igual sea visible arriba
  //    si monto+fecha calzan bien. La UI muestra un warning cuando difieren.
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
