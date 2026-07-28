import { describe, expect, it } from "vitest";

import { computeRevenue } from "./revenue";
import type {
  FinanceInvoiceRow,
  FinanceLaunchSettlementRow,
} from "./types";

function settlement(
  overrides: Partial<FinanceLaunchSettlementRow> = {},
): FinanceLaunchSettlementRow {
  return {
    kingrow_retained: 0,
    status: "liquidada",
    closed_at: "2026-07-01T00:00:00Z",
    created_at: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

function invoice(overrides: Partial<FinanceInvoiceRow> = {}): FinanceInvoiceRow {
  return {
    amount_gross: 0,
    tax_amount: 0,
    status: "cobrada",
    paid_at: "2026-07-15",
    due_date: "2026-07-15",
    issue_date: "2026-07-01",
    ...overrides,
  };
}

describe("computeRevenue — filtros de status", () => {
  it("suma kingrow_retained SOLO de settlements liquidadas + transferidas", () => {
    const r = computeRevenue({
      settlements: [
        settlement({ kingrow_retained: 1000, status: "liquidada" }),
        settlement({ kingrow_retained: 2000, status: "transferida" }),
        settlement({ kingrow_retained: 9999, status: "abierta" }), // NO cuenta
      ],
      invoices: [],
    });
    expect(r.revenueFromSettlements).toBe(3000);
    expect(r.revenueTotal).toBe(3000);
  });

  it("borradores (abierta) NUNCA cuentan como ingreso realizado", () => {
    const r = computeRevenue({
      settlements: [
        settlement({ kingrow_retained: 5000, status: "abierta" }),
        settlement({ kingrow_retained: 5000, status: "abierta" }),
      ],
      invoices: [],
    });
    expect(r.revenueFromSettlements).toBe(0);
    expect(r.revenueTotal).toBe(0);
  });

  it("suma invoices SOLO cobradas; emitida/vencida/anulada NO cuentan", () => {
    const r = computeRevenue({
      settlements: [],
      invoices: [
        invoice({ amount_gross: 1210, tax_amount: 210, status: "cobrada" }),
        invoice({ amount_gross: 5000, tax_amount: 0, status: "emitida" }),
        invoice({ amount_gross: 8000, tax_amount: 0, status: "vencida" }),
        invoice({ amount_gross: 3000, tax_amount: 0, status: "anulada" }),
      ],
    });
    // Solo la cobrada, y NETA de IVA: 1210 − 210 = 1000
    expect(r.revenueFromInvoices).toBe(1000);
    expect(r.revenueTotal).toBe(1000);
  });

  it("invoice cobrada con IVA se cuenta NETO (gross − tax)", () => {
    const r = computeRevenue({
      settlements: [],
      invoices: [
        invoice({ amount_gross: 12100, tax_amount: 2100 }),
      ],
    });
    expect(r.revenueFromInvoices).toBe(10000);
  });

  it("otherIncome se suma tal cual", () => {
    const r = computeRevenue({
      settlements: [],
      invoices: [],
      otherIncome: 500,
    });
    expect(r.otherIncome).toBe(500);
    expect(r.revenueTotal).toBe(500);
  });

  it("caso combinado (settlements + invoices + other)", () => {
    const r = computeRevenue({
      settlements: [
        settlement({ kingrow_retained: 30000, status: "liquidada" }),
        settlement({ kingrow_retained: 20000, status: "transferida" }),
        settlement({ kingrow_retained: 99999, status: "abierta" }),
      ],
      invoices: [
        invoice({ amount_gross: 12100, tax_amount: 2100, status: "cobrada" }),
        invoice({ amount_gross: 5000, tax_amount: 0, status: "emitida" }),
      ],
      otherIncome: 1500,
    });
    expect(r.revenueFromSettlements).toBe(50000);
    expect(r.revenueFromInvoices).toBe(10000);
    expect(r.otherIncome).toBe(1500);
    expect(r.revenueTotal).toBe(61500);
  });

  it("input vacío → todo en 0", () => {
    const r = computeRevenue({ settlements: [], invoices: [] });
    expect(r.revenueFromSettlements).toBe(0);
    expect(r.revenueFromInvoices).toBe(0);
    expect(r.otherIncome).toBe(0);
    expect(r.revenueTotal).toBe(0);
  });
});
