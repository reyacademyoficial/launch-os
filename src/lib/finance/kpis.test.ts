import { describe, expect, it } from "vitest";

import { computeRevenue } from "./revenue";
import {
  clientBalance,
  computeAccountsPayable,
  computeAccountsReceivable,
  computeBurnRate,
  computeCashFlow,
  computeNetWorth,
  computeProfit,
  computeRunway,
  sumExpensesNet,
  sumPayrollTotal,
} from "./kpis";
import type {
  FinanceAssetRow,
  FinanceBankMovementRow,
  FinanceClientTransferRow,
  FinanceExpenseRow,
  FinanceInvoiceRow,
  FinanceLiabilityRow,
  FinancePayrollRow,
} from "./types";

// ══════════════════ Helpers de fixtures ══════════════════

function expense(overrides: Partial<FinanceExpenseRow> = {}): FinanceExpenseRow {
  return {
    amount_gross: 0,
    tax_amount: 0,
    category: null,
    paid_at: null,
    due_date: null,
    expense_date: "2026-07-01",
    ...overrides,
  };
}

function payroll(overrides: Partial<FinancePayrollRow> = {}): FinancePayrollRow {
  return {
    total_amount: 0,
    paid_at: null,
    due_date: null,
    period_start: "2026-07-01",
    period_end: "2026-07-31",
    ...overrides,
  };
}

function invoice(overrides: Partial<FinanceInvoiceRow> = {}): FinanceInvoiceRow {
  return {
    amount_gross: 0,
    tax_amount: 0,
    status: "emitida",
    paid_at: null,
    due_date: null,
    issue_date: "2026-07-01",
    ...overrides,
  };
}

function transfer(
  overrides: Partial<FinanceClientTransferRow> = {},
): FinanceClientTransferRow {
  return {
    amount: 0,
    direction: "a_favor_cliente",
    date: "2026-07-01",
    ...overrides,
  };
}

function asset(overrides: Partial<FinanceAssetRow> = {}): FinanceAssetRow {
  return { amount: 0, active: true, ...overrides };
}

function liability(
  overrides: Partial<FinanceLiabilityRow> = {},
): FinanceLiabilityRow {
  return { amount: 0, active: true, settled_at: null, ...overrides };
}

function movement(
  overrides: Partial<FinanceBankMovementRow> = {},
): FinanceBankMovementRow {
  return { amount: 0, kind: "in", occurred_at: "2026-07-01", ...overrides };
}

// ══════════════════ Helpers de agregación ══════════════════

describe("sumExpensesNet", () => {
  it("suma gross - tax por cada expense", () => {
    const total = sumExpensesNet([
      expense({ amount_gross: 1210, tax_amount: 210 }),
      expense({ amount_gross: 500, tax_amount: 0 }),
    ]);
    expect(total).toBe(1500);
  });
});

describe("sumPayrollTotal", () => {
  it("suma total_amount tal cual (deducciones ya reflejadas)", () => {
    const total = sumPayrollTotal([
      payroll({ total_amount: 300000 }),
      payroll({ total_amount: 250000 }),
    ]);
    expect(total).toBe(550000);
  });
});

describe("clientBalance", () => {
  it("positivo cuando Kingrow le debe al cliente (a_favor > transferido)", () => {
    const bal = clientBalance([
      transfer({ amount: 5000, direction: "a_favor_cliente" }),
      transfer({ amount: 2000, direction: "transferido" }),
    ]);
    expect(bal).toBe(3000);
  });

  it("negativo cuando el cliente le debe a Kingrow (transferido > a_favor)", () => {
    const bal = clientBalance([
      transfer({ amount: 2000, direction: "a_favor_cliente" }),
      transfer({ amount: 5000, direction: "transferido" }),
    ]);
    expect(bal).toBe(-3000);
  });

  it("0 cuando la cuenta está saldada", () => {
    expect(clientBalance([])).toBe(0);
  });
});

// ══════════════════ Utilidad y margen ══════════════════

describe("computeProfit", () => {
  it("caso completo con las 4 líneas de costo", () => {
    const p = computeProfit({
      revenue: 100000,
      directCosts: 30000,
      operatingExpenses: 10000,
      payroll: 40000,
      taxes: 5000,
    });
    expect(p.grossProfit).toBe(70000);          // 100k − 30k
    expect(p.operatingProfit).toBe(20000);       // 70k − 10k − 40k
    expect(p.netProfit).toBe(15000);             // 20k − 5k
    expect(p.grossMargin).toBeCloseTo(0.7);      // 70%
    expect(p.netMargin).toBeCloseTo(0.15);       // 15%
  });

  it("costos = 0 → grossProfit = revenue, netMargin = 100%", () => {
    const p = computeProfit({ revenue: 50000 });
    expect(p.grossProfit).toBe(50000);
    expect(p.operatingProfit).toBe(50000);
    expect(p.netProfit).toBe(50000);
    expect(p.netMargin).toBe(1);
  });

  it("revenue = 0 → margins son null (no NaN/Infinity)", () => {
    const p = computeProfit({ revenue: 0, payroll: 10000 });
    expect(p.netProfit).toBe(-10000);
    expect(p.grossMargin).toBeNull();
    expect(p.netMargin).toBeNull();
  });

  it("utilidad NEGATIVA cuando los costos superan al revenue", () => {
    const p = computeProfit({
      revenue: 10000,
      directCosts: 5000,
      operatingExpenses: 8000,
      payroll: 15000,
    });
    expect(p.grossProfit).toBe(5000);
    expect(p.operatingProfit).toBe(-18000);
    expect(p.netProfit).toBe(-18000);
    expect(p.netMargin).toBeCloseTo(-1.8);
  });
});

// ══════════════════ Patrimonio ══════════════════

describe("computeNetWorth", () => {
  it("activos − pasivos − payables corrientes", () => {
    const nw = computeNetWorth({
      assets: [asset({ amount: 100000 }), asset({ amount: 50000 })],
      liabilities: [liability({ amount: 30000 })],
      currentPayables: 5000,
    });
    expect(nw.totalAssets).toBe(150000);
    expect(nw.totalLiabilities).toBe(30000);
    expect(nw.netWorth).toBe(115000);
  });

  it("filtra activos con active=false", () => {
    const nw = computeNetWorth({
      assets: [asset({ amount: 100000 }), asset({ amount: 99999, active: false })],
      liabilities: [],
    });
    expect(nw.totalAssets).toBe(100000);
    expect(nw.netWorth).toBe(100000);
  });

  it("filtra pasivos saldados (settled_at != null) o inactivos", () => {
    const nw = computeNetWorth({
      assets: [],
      liabilities: [
        liability({ amount: 10000 }),
        liability({ amount: 20000, settled_at: "2026-06-01" }),  // saldado
        liability({ amount: 30000, active: false }),               // inactivo
      ],
    });
    expect(nw.totalLiabilities).toBe(10000);
    expect(nw.netWorth).toBe(-10000);
  });

  it("sin currentPayables el default es 0", () => {
    const nw = computeNetWorth({
      assets: [asset({ amount: 1000 })],
      liabilities: [],
    });
    expect(nw.currentPayables).toBe(0);
    expect(nw.netWorth).toBe(1000);
  });
});

// ══════════════════ AR / AP ══════════════════

describe("computeAccountsReceivable", () => {
  it("cuenta invoices emitida + vencida (no cobradas ni anuladas)", () => {
    const ar = computeAccountsReceivable({
      invoices: [
        invoice({ amount_gross: 1210, tax_amount: 210, status: "emitida" }),
        invoice({ amount_gross: 6050, tax_amount: 1050, status: "vencida" }),
        invoice({ amount_gross: 5000, tax_amount: 0, status: "cobrada" }),   // NO
        invoice({ amount_gross: 3000, tax_amount: 0, status: "anulada" }),  // NO
      ],
    });
    expect(ar.invoicesCount).toBe(2);
    expect(ar.invoicesReceivableGross).toBe(7260);      // 1210 + 6050
    expect(ar.invoicesReceivableNet).toBe(6000);        // 1000 + 5000
    expect(ar.totalReceivable).toBe(6000);
  });

  it("suma favorKingrowBalance al totalReceivable", () => {
    const ar = computeAccountsReceivable({
      invoices: [],
      favorKingrowBalance: 4000,
    });
    expect(ar.totalReceivable).toBe(4000);
  });
});

describe("computeAccountsPayable", () => {
  it("suma expenses no pagadas (net) + payroll no pagada + saldo a favor cliente", () => {
    const ap = computeAccountsPayable({
      expenses: [
        expense({ amount_gross: 1210, tax_amount: 210, paid_at: null }),  // 1000 pending
        expense({ amount_gross: 5000, tax_amount: 0, paid_at: "2026-07-10" }), // paid, NO cuenta
      ],
      payroll: [
        payroll({ total_amount: 300000, paid_at: null }),                 // pending
        payroll({ total_amount: 250000, paid_at: "2026-07-05" }),         // paid, NO
      ],
      clientTransfers: [
        transfer({ amount: 8000, direction: "a_favor_cliente" }),
        transfer({ amount: 3000, direction: "transferido" }),
      ],
    });
    expect(ap.expensesPayableNet).toBe(1000);
    expect(ap.payrollPayable).toBe(300000);
    expect(ap.clientPayable).toBe(5000);                                    // 8k − 3k
    expect(ap.totalPayable).toBe(306000);
  });

  it("clientPayable se clampa a 0 cuando el balance es negativo (es AR)", () => {
    const ap = computeAccountsPayable({
      expenses: [],
      payroll: [],
      clientTransfers: [
        transfer({ amount: 1000, direction: "a_favor_cliente" }),
        transfer({ amount: 5000, direction: "transferido" }),
      ],
    });
    expect(ap.clientPayable).toBe(0);
    expect(ap.totalPayable).toBe(0);
  });
});

// ══════════════════ Cash flow ══════════════════

describe("computeCashFlow", () => {
  it("suma ins − outs", () => {
    const cf = computeCashFlow({
      bankMovements: [
        movement({ amount: 5000, kind: "in" }),
        movement({ amount: 3000, kind: "in" }),
        movement({ amount: 2000, kind: "out" }),
      ],
    });
    expect(cf.cashIn).toBe(8000);
    expect(cf.cashOut).toBe(2000);
    expect(cf.operatingCashIn).toBe(0);
    expect(cf.netCashFlow).toBe(6000);
  });

  it("operatingCashIn se suma al neto", () => {
    const cf = computeCashFlow({
      bankMovements: [movement({ amount: 1000, kind: "out" })],
      operatingCashIn: 50000,
    });
    expect(cf.netCashFlow).toBe(49000);
  });
});

// ══════════════════ Runway ══════════════════

describe("computeBurnRate", () => {
  it("promedia (expenses net + payroll) sobre meses", () => {
    const burn = computeBurnRate({
      expenses: [
        expense({ amount_gross: 12100, tax_amount: 2100 }), // 10k net
      ],
      payroll: [
        payroll({ total_amount: 200000 }),
        payroll({ total_amount: 200000 }),
      ],
      monthsInWindow: 2,
    });
    // (10000 + 400000) / 2 = 205000
    expect(burn).toBe(205000);
  });

  it("meses = 0 → burn = 0 (no revienta con /0)", () => {
    const burn = computeBurnRate({
      expenses: [expense({ amount_gross: 1000, tax_amount: 0 })],
      payroll: [],
      monthsInWindow: 0,
    });
    expect(burn).toBe(0);
  });
});

describe("computeRunway", () => {
  it("cash / burn = meses restantes", () => {
    expect(computeRunway({ cashOnHand: 1_000_000, monthlyBurn: 200_000 }))
      .toBe(5);
  });

  it("burn ≤ 0 → null (runway infinito, la UI muestra ∞ o —)", () => {
    expect(computeRunway({ cashOnHand: 500_000, monthlyBurn: 0 })).toBeNull();
    expect(computeRunway({ cashOnHand: 500_000, monthlyBurn: -100 })).toBeNull();
  });

  it("cash ≤ 0 con burn > 0 → 0 (ya no queda caja)", () => {
    expect(computeRunway({ cashOnHand: 0, monthlyBurn: 100_000 })).toBe(0);
    expect(computeRunway({ cashOnHand: -50, monthlyBurn: 100_000 })).toBe(0);
  });
});

// ══════════════════ Integración: pipeline completo ══════════════════

describe("Pipeline integrado — cifras que se compone entre módulos", () => {
  it("revenue → profit → margin cierra la aritmética", () => {
    // Escenario: mes con 1 liquidación (Kingrow retiene 30k), 1 factura de
    // fee cobrada (10k neto), gastos operativos 8k neto, nómina 15k. Sin
    // impuestos ni costos directos separados.
    const revenue = computeRevenue({
      settlements: [
        { kingrow_retained: 30000, status: "liquidada",
          closed_at: "2026-07-15", created_at: "2026-07-01" },
      ],
      invoices: [
        { amount_gross: 12100, tax_amount: 2100, status: "cobrada",
          paid_at: "2026-07-20", due_date: "2026-07-15",
          issue_date: "2026-07-01" },
      ],
    });
    expect(revenue.revenueTotal).toBe(40000);   // 30k + 10k

    const profit = computeProfit({
      revenue: revenue.revenueTotal,
      operatingExpenses: 8000,
      payroll: 15000,
    });
    expect(profit.grossProfit).toBe(40000);      // sin directCosts
    expect(profit.operatingProfit).toBe(17000);  // 40k − 8k − 15k
    expect(profit.netProfit).toBe(17000);
    expect(profit.netMargin).toBeCloseTo(0.425); // 42.5%
  });

  it("AR + AP + patrimonio cierran de forma consistente", () => {
    const ap = computeAccountsPayable({
      expenses: [expense({ amount_gross: 6000, tax_amount: 1000, paid_at: null })],
      payroll: [payroll({ total_amount: 100000, paid_at: null })],
      clientTransfers: [
        transfer({ amount: 20000, direction: "a_favor_cliente" }),
      ],
    });
    // 5000 (expense net) + 100000 (payroll) + 20000 (clientPayable) = 125000
    expect(ap.totalPayable).toBe(125000);

    const ar = computeAccountsReceivable({
      invoices: [
        invoice({ amount_gross: 6050, tax_amount: 1050, status: "emitida" }),
      ],
    });
    expect(ar.totalReceivable).toBe(5000);

    const nw = computeNetWorth({
      assets: [asset({ amount: 500_000 })],
      liabilities: [liability({ amount: 100_000 })],
      currentPayables: ap.totalPayable,
    });
    // 500k − 100k − 125k = 275k
    expect(nw.netWorth).toBe(275_000);
  });
});
