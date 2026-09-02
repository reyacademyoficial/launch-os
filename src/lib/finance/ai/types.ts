/**
 * Shapes del snapshot financiero que se le pasa a la IA como contexto.
 *
 * Todo lo que vive acá está YA CONVERTIDO A USD por el builder
 * (`snapshot.ts`) — la IA nunca ve montos en monedas mezcladas, porque
 * sumar ARS con USD en un análisis de "qué gasto sobra" es el error más
 * caro que podría cometer.
 *
 * Los tipos son puros (sin dependencias de Supabase) para que los
 * selectores de `aggregate.ts` y el renderer de `render.ts` se testeen con
 * literales.
 */

import type { ExpenseBucket } from "../expense-categories";

// ═══════════════════════════════════════════════════════════════════════════
// Entrada — gasto individual normalizado a USD
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Un gasto ya convertido. `netUsd` = gross − IVA (misma base que el P&L del
 * dashboard, para que los números que cita la IA coincidan con la pantalla).
 */
export interface ExpenseDetail {
  readonly id: string;
  readonly description: string;
  readonly category: string | null;
  readonly netUsd: number;
  readonly currency: "ARS" | "USD";
  /** Monto en moneda original — para que la IA pueda citar el importe real. */
  readonly nativeGross: number;
  readonly expenseDate: string;
  readonly paidAt: string | null;
  readonly dueDate: string | null;
  readonly supplierName: string | null;
  readonly projectName: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Agregados
// ═══════════════════════════════════════════════════════════════════════════

export interface CategoryStat {
  readonly slug: string;
  readonly label: string;
  readonly bucket: ExpenseBucket;
  readonly totalUsd: number;
  readonly count: number;
  /** Meses distintos (dentro de la ventana) con al menos un gasto. */
  readonly monthsWithSpend: number;
  /** Total ÷ meses de la ventana (no ÷ meses con gasto): promedio real. */
  readonly avgPerMonthUsd: number;
  readonly lastMonthUsd: number;
  /** Participación sobre el total de gastos de la ventana, en [0,1]. */
  readonly share: number;
}

/**
 * Gasto que se repite mes a mes bajo la misma descripción normalizada —
 * la señal más útil para "¿qué suscripción estoy pagando de gusto?".
 */
export interface RecurringExpense {
  readonly key: string;
  readonly description: string;
  readonly category: string | null;
  readonly supplierName: string | null;
  readonly months: number;
  readonly totalUsd: number;
  readonly avgUsd: number;
  readonly minUsd: number;
  readonly maxUsd: number;
  readonly lastYmd: string;
  readonly lastUsd: number;
}

export interface MonthlyFinanceRow {
  readonly key: string;
  readonly label: string;
  readonly revenueUsd: number;
  readonly directUsd: number;
  readonly operatingUsd: number;
  readonly taxesUsd: number;
  readonly payrollUsd: number;
  readonly netProfitUsd: number;
}

export interface PersonPayrollStat {
  readonly personName: string;
  readonly totalUsd: number;
  readonly periods: number;
  readonly avgPerPeriodUsd: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Snapshot completo
// ═══════════════════════════════════════════════════════════════════════════

export interface FinanceSnapshot {
  readonly generatedAt: string;
  /** Ventana de análisis: los N meses que cubren series y agregados. */
  readonly windowFromYmd: string;
  readonly windowToYmd: string;
  readonly windowMonths: number;
  /** Mes cerrado más reciente ("YYYY-MM") — referencia de "el último mes". */
  readonly lastClosedMonthKey: string;

  readonly monthly: readonly MonthlyFinanceRow[];
  readonly categories: readonly CategoryStat[];
  readonly recurring: readonly RecurringExpense[];
  readonly topExpenses: readonly ExpenseDetail[];
  readonly unpaidExpenses: readonly ExpenseDetail[];
  readonly payrollByPerson: readonly PersonPayrollStat[];

  readonly totals: {
    readonly revenueUsd: number;
    readonly expensesNetUsd: number;
    readonly payrollUsd: number;
    readonly payoutsUsd: number;
    readonly netProfitUsd: number;
    readonly marginPct: number;
  };

  readonly position: {
    readonly cashUsd: number | null;
    readonly activeBanks: number;
    readonly burnMonthlyUsd: number;
    readonly runwayMonths: number | null;
    readonly runwayReason: string;
    readonly receivableUsd: number;
    readonly payableUsd: number;
    readonly netWorthUsd: number;
  };

  readonly fx: {
    readonly latestRate: number | null;
    readonly latestRateMonth: string | null;
  };

  /** Avisos de calidad de dato — la IA tiene que decirlos, no taparlos. */
  readonly warnings: readonly string[];
}
