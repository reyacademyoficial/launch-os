/**
 * KPIs financieros de Kingrow — funciones puras, sin acceso a DB.
 *
 * Estilo: mismo molde que `src/lib/kpis.ts` (KPIs de lanzamiento) y
 * `src/lib/settlements/calc.ts`. Cada función recibe rows ya leídas por el
 * caller y devuelve el número/desglose. NUNCA importa `supabase`. Tests
 * mock las rows directamente.
 *
 * FÓRMULAS CONTABLES — bases estándar, cada una documentada. Marcadas con
 * `// REVISAR CON CONTADOR` las que involucran criterios ambiguos
 * (devengado vs. percibido, qué entra como costo directo vs. gasto
 * operativo, cómo tratar IVA en un régimen simplificado, etc.).
 *
 * FILTRO DE PERÍODO: ninguna función filtra por fecha. El caller pasa
 * rows ya filtradas — mismo criterio que `computeRevenue` en `revenue.ts`.
 */

import type {
  FinanceAssetRow,
  FinanceBankMovementRow,
  FinanceClientTransferRow,
  FinanceExpenseRow,
  FinanceInvoiceRow,
  FinanceLiabilityRow,
  FinancePayrollRow,
} from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// Helpers de agregación
// ═══════════════════════════════════════════════════════════════════════════

/** Σ (amount_gross − tax_amount) de gastos. Neto de IVA. */
export function sumExpensesNet(expenses: FinanceExpenseRow[]): number {
  return expenses.reduce(
    (acc, e) => acc + (e.amount_gross - e.tax_amount),
    0,
  );
}

/** Σ total_amount de payroll (ya viene con extras/deducciones aplicadas). */
export function sumPayrollTotal(payroll: FinancePayrollRow[]): number {
  return payroll.reduce((acc, p) => acc + p.total_amount, 0);
}

/**
 * Balance neto con clientes externos: Σ a_favor_cliente − Σ transferido.
 *   > 0 → Kingrow le DEBE al cliente (pasivo corriente).
 *   < 0 → El cliente le debe a Kingrow (activo corriente, raro pero puede
 *         pasar por adelantos).
 *   = 0 → cuenta saldada.
 */
export function clientBalance(
  transfers: FinanceClientTransferRow[],
): number {
  return transfers.reduce((acc, t) => {
    return t.direction === "a_favor_cliente"
      ? acc + t.amount
      : acc - t.amount;
  }, 0);
}

// ═══════════════════════════════════════════════════════════════════════════
// Utilidad y margen — estado de resultados
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Inputs para el P&L. El caller decide cómo clasificar gastos en
 * directo vs. operativo — es una decisión contable con criterio. Los
 * defaults son 0 para que el caller pueda armar el objeto incrementalmente.
 *
 * // REVISAR CON CONTADOR: la línea entre "costo directo" y "gasto
 * operativo" es opinionada. Base sugerida:
 *   - directCosts: costo IA + comisiones de ventas + ads del lanzamiento
 *     (todo lo que se puede atribuir a UN lanzamiento específico).
 *   - operatingExpenses: SaaS, oficina, servicios profesionales, otros
 *     (no atribuibles a un lanzamiento).
 *   - payroll y taxes van en sus propias líneas para poder verlas separadas.
 */
export interface ProfitInputs {
  /** Ingresos totales del período (usar `computeRevenue().revenueTotal`). */
  revenue: number;
  /** Costos directos: atribuibles a un lanzamiento (ads, IA, comisiones). */
  directCosts?: number;
  /** Gastos operativos: no atribuibles (SaaS, oficina, servicios). */
  operatingExpenses?: number;
  /** Nómina del período. */
  payroll?: number;
  /** Impuestos que restan del resultado (Ganancias, IIBB neto, etc.). */
  taxes?: number;
}

export interface ProfitBreakdown {
  /** revenue − directCosts. Utilidad antes de gastos operativos. */
  grossProfit: number;
  /** grossProfit − operatingExpenses − payroll. Utilidad antes de impuestos. */
  operatingProfit: number;
  /** operatingProfit − taxes. Bottom line. */
  netProfit: number;
  /** grossProfit / revenue. `null` si revenue = 0. */
  grossMargin: number | null;
  /** netProfit / revenue. `null` si revenue = 0. */
  netMargin: number | null;
}

export function computeProfit(inputs: ProfitInputs): ProfitBreakdown {
  const revenue = inputs.revenue;
  const directCosts = inputs.directCosts ?? 0;
  const operatingExpenses = inputs.operatingExpenses ?? 0;
  const payroll = inputs.payroll ?? 0;
  const taxes = inputs.taxes ?? 0;

  const grossProfit = revenue - directCosts;
  const operatingProfit = grossProfit - operatingExpenses - payroll;
  const netProfit = operatingProfit - taxes;

  const grossMargin = revenue !== 0 ? grossProfit / revenue : null;
  const netMargin = revenue !== 0 ? netProfit / revenue : null;

  return {
    grossProfit,
    operatingProfit,
    netProfit,
    grossMargin,
    netMargin,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Patrimonio neto — balance
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Patrimonio neto = Σ activos − Σ pasivos.
 *
 * `assets` filtramos por `active=true` (bienes vigentes en libros).
 * `liabilities` filtramos por `active=true` y `settled_at IS NULL`.
 *
 * `currentPayables` es el AP corriente calculado aparte
 * (`computeAccountsPayable().totalPayable`) — se pasa opcional para que
 * el patrimonio neto contemple la deuda corriente además de la de largo
 * plazo de `liabilities`. Si se omite, solo se restan los pasivos formales.
 *
 * // REVISAR CON CONTADOR: sumar AP corriente al patrimonio neto es una
 * decisión de presentación. La lectura conservadora (que es la de este
 * selector) los suma. La lectura "solo pasivos formales" los omite —
 * pasar `currentPayables=0` en ese caso.
 */
export interface NetWorthInputs {
  assets: FinanceAssetRow[];
  liabilities: FinanceLiabilityRow[];
  currentPayables?: number;
}

export interface NetWorthBreakdown {
  totalAssets: number;
  totalLiabilities: number;
  currentPayables: number;
  netWorth: number;
}

export function computeNetWorth(inputs: NetWorthInputs): NetWorthBreakdown {
  const totalAssets = inputs.assets
    .filter((a) => a.active)
    .reduce((acc, a) => acc + a.amount, 0);

  const totalLiabilities = inputs.liabilities
    .filter((l) => l.active && l.settled_at == null)
    .reduce((acc, l) => acc + l.amount, 0);

  const currentPayables = inputs.currentPayables ?? 0;

  return {
    totalAssets,
    totalLiabilities,
    currentPayables,
    netWorth: totalAssets - totalLiabilities - currentPayables,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Cuentas por cobrar (AR)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * AR = invoices emitidas o vencidas (no cobradas ni anuladas) NETO de IVA.
 *
 * // REVISAR CON CONTADOR: NETO de IVA es criterio de balance típico.
 * Si se prefiere ver el BRUTO (que es lo que efectivamente se va a cobrar
 * en caja), pedirlo — está en un campo separado `totalReceivableGross`.
 *
 * `favorKingrowBalance` es el hueco para "saldos a favor de Kingrow con
 * clientes" (poco común — pasa cuando el cliente adelantó menos que lo
 * devengado y hay una liquidación pendiente sin transferir). El caller lo
 * calcula con `clientBalance(...)` si aplica; por defecto 0.
 */
export interface AccountsReceivableInputs {
  invoices: FinanceInvoiceRow[];
  /** Positivo si algún cliente le debe a Kingrow. Default 0. */
  favorKingrowBalance?: number;
}

export interface AccountsReceivableBreakdown {
  /** Σ (amount_gross − tax_amount) de invoices no-cobradas y no-anuladas. */
  invoicesReceivableNet: number;
  /** Σ amount_gross (para verlo bruto si hace falta). */
  invoicesReceivableGross: number;
  /** Cantidad de facturas contadas. Útil para el UI. */
  invoicesCount: number;
  /** Pasado por el caller. */
  favorKingrowBalance: number;
  /** invoicesReceivableNet + favorKingrowBalance. */
  totalReceivable: number;
}

function isInvoicePending(i: FinanceInvoiceRow): boolean {
  return i.status !== "cobrada" && i.status !== "anulada";
}

export function computeAccountsReceivable(
  inputs: AccountsReceivableInputs,
): AccountsReceivableBreakdown {
  const pending = inputs.invoices.filter(isInvoicePending);

  const invoicesReceivableNet = pending.reduce(
    (acc, i) => acc + (i.amount_gross - i.tax_amount),
    0,
  );
  const invoicesReceivableGross = pending.reduce(
    (acc, i) => acc + i.amount_gross,
    0,
  );

  const favorKingrowBalance = inputs.favorKingrowBalance ?? 0;

  return {
    invoicesReceivableNet,
    invoicesReceivableGross,
    invoicesCount: pending.length,
    favorKingrowBalance,
    totalReceivable: invoicesReceivableNet + favorKingrowBalance,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Cuentas por pagar (AP)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * AP corriente = gastos devengados no pagados + nómina devengada no pagada
 *              + saldo a favor de clientes (lo que Kingrow le debe a externos).
 *
 * Los pasivos de largo plazo (`liabilities`) NO entran acá — esos van al
 * balance vía `computeNetWorth`. La distinción es corriente vs. no corriente.
 *
 * // REVISAR CON CONTADOR: mismo criterio NETO de IVA que en AR. Cambiar
 * a BRUTO si el contador lo prefiere para presentación de estados.
 */
export interface AccountsPayableInputs {
  expenses: FinanceExpenseRow[];
  payroll: FinancePayrollRow[];
  clientTransfers: FinanceClientTransferRow[];
}

export interface AccountsPayableBreakdown {
  /** Σ (gross − tax) de expenses sin paid_at. */
  expensesPayableNet: number;
  /** Σ total_amount de payroll sin paid_at. */
  payrollPayable: number;
  /**
   * Saldo neto a favor del cliente (Kingrow lo debe). Nunca negativo:
   * si el balance da negativo (cliente le debe a Kingrow) se clampa a 0
   * y el neto positivo debería ir a AR vía `favorKingrowBalance`.
   */
  clientPayable: number;
  /** Suma de las tres líneas. */
  totalPayable: number;
}

export function computeAccountsPayable(
  inputs: AccountsPayableInputs,
): AccountsPayableBreakdown {
  const expensesPayableNet = inputs.expenses
    .filter((e) => e.paid_at == null)
    .reduce((acc, e) => acc + (e.amount_gross - e.tax_amount), 0);

  const payrollPayable = inputs.payroll
    .filter((p) => p.paid_at == null)
    .reduce((acc, p) => acc + p.total_amount, 0);

  const rawClientBalance = clientBalance(inputs.clientTransfers);
  // Cap a 0 por abajo: si el balance es negativo, el cliente le debe a
  // Kingrow — eso es AR, no AP. Se maneja pasándolo a
  // computeAccountsReceivable().favorKingrowBalance.
  const clientPayable = Math.max(rawClientBalance, 0);

  return {
    expensesPayableNet,
    payrollPayable,
    clientPayable,
    totalPayable: expensesPayableNet + payrollPayable + clientPayable,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Cash flow del período
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Cash flow = Σ movimientos 'in' − Σ movimientos 'out' del período.
 *
 * IMPORTANTE: `bank_movements` NO incluye los cobros de sales (que van a
 * `payments` directo, no a bank_movements — ver comentario cabecera de
 * 0044). Este selector mide flujo de caja NO-operativo puro (ingresos
 * ad-hoc, gastos pagados, transferencias, ajustes).
 *
 * // REVISAR CON CONTADOR: para un cash flow OPERATIVO completo hay que
 * sumar además Σ payments del período. El caller puede pasar
 * `operatingCashIn` como línea extra si lo necesita.
 */
export interface CashFlowInputs {
  bankMovements: FinanceBankMovementRow[];
  /** Cobros operativos (Σ payments del período) — opcional, default 0. */
  operatingCashIn?: number;
}

export interface CashFlowBreakdown {
  cashIn: number;
  cashOut: number;
  operatingCashIn: number;
  netCashFlow: number;
}

export function computeCashFlow(inputs: CashFlowInputs): CashFlowBreakdown {
  let cashIn = 0;
  let cashOut = 0;
  for (const m of inputs.bankMovements) {
    if (m.kind === "in") cashIn += m.amount;
    else cashOut += m.amount;
  }
  const operatingCashIn = inputs.operatingCashIn ?? 0;
  return {
    cashIn,
    cashOut,
    operatingCashIn,
    netCashFlow: cashIn + operatingCashIn - cashOut,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Runway
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Burn rate mensual promedio = (Σ gastos netos + Σ payroll) / meses.
 * `monthsInWindow` DEBE ser positivo (>0) — si es 0 devolvemos 0 y el
 * caller/UI decide qué hacer.
 *
 * // REVISAR CON CONTADOR: burn puede definirse como "gastos + payroll"
 * (lo que hacemos) o como "gastos + payroll + impuestos + comisiones
 * pagadas". Depende de cómo mida el contador la "quema" real de caja.
 */
export interface BurnRateInputs {
  expenses: FinanceExpenseRow[];
  payroll: FinancePayrollRow[];
  monthsInWindow: number;
}

export function computeBurnRate(inputs: BurnRateInputs): number {
  if (inputs.monthsInWindow <= 0) return 0;
  const expensesTotal = sumExpensesNet(inputs.expenses);
  const payrollTotal = sumPayrollTotal(inputs.payroll);
  return (expensesTotal + payrollTotal) / inputs.monthsInWindow;
}

/**
 * Runway = caja disponible ÷ burn mensual.
 *
 *   - Devuelve MESES restantes hasta agotar la caja al ritmo actual.
 *   - `null` cuando `monthlyBurn <= 0` (no hay quema → runway infinito;
 *     la UI muestra "∞" o "—" según prefiera).
 *   - `0` cuando `cashOnHand <= 0` (ya no hay caja).
 *
 * // REVISAR CON CONTADOR: runway "en meses" es la convención SaaS
 * estándar. Si el contador prefiere "en días" es multiplicar por 30.44
 * (o dividir el burn por 30.44 antes de pasar).
 */
export interface RunwayInputs {
  cashOnHand: number;
  monthlyBurn: number;
}

export function computeRunway(inputs: RunwayInputs): number | null {
  if (inputs.monthlyBurn <= 0) return null;
  if (inputs.cashOnHand <= 0) return 0;
  return inputs.cashOnHand / inputs.monthlyBurn;
}
