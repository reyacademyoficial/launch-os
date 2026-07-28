import { describe, expect, it } from "vitest";

import { computeLtv } from "./ltv";
import type {
  ClientsInvoiceRow,
  ClientsSettlementRow,
  RenewalRow,
  UpsellRow,
} from "./types";

function settlement(
  overrides: Partial<ClientsSettlementRow> = {},
): ClientsSettlementRow {
  return {
    project_id: "proj-a",
    kingrow_retained: 0,
    status: "liquidada",
    ...overrides,
  };
}

function invoice(
  overrides: Partial<ClientsInvoiceRow> = {},
): ClientsInvoiceRow {
  return {
    project_id: "proj-a",
    amount_gross: 0,
    tax_amount: 0,
    status: "cobrada",
    ...overrides,
  };
}

function renewal(overrides: Partial<RenewalRow> = {}): RenewalRow {
  return {
    project_id: "proj-a",
    period_start: "2026-01-01",
    period_end: "2026-01-31",
    amount: 0,
    status: "cobrada",
    collected_at: "2026-02-01",
    ...overrides,
  };
}

function upsell(overrides: Partial<UpsellRow> = {}): UpsellRow {
  return {
    project_id: "proj-a",
    amount: 0,
    status: "cobrada",
    closed_at: "2026-02-01",
    ...overrides,
  };
}

describe("computeLtv — settlements", () => {
  it("suma kingrow_retained SOLO de liquidada + transferida", () => {
    const l = computeLtv({
      settlements: [
        settlement({ kingrow_retained: 1000, status: "liquidada" }),
        settlement({ kingrow_retained: 2000, status: "transferida" }),
        settlement({ kingrow_retained: 9999, status: "abierta" }), // no cuenta
      ],
      invoices: [],
      renewals: [],
      upsells: [],
    });
    expect(l.fromSettlements).toBe(3000);
    expect(l.total).toBe(3000);
  });
});

describe("computeLtv — invoices", () => {
  it("suma neto (gross − tax) de invoices COBRADAS con project_id", () => {
    const l = computeLtv({
      settlements: [],
      invoices: [
        invoice({ amount_gross: 1210, tax_amount: 210, status: "cobrada" }),
        invoice({ amount_gross: 500, tax_amount: 0, status: "cobrada" }),
      ],
      renewals: [],
      upsells: [],
    });
    expect(l.fromInvoices).toBe(1500);
    expect(l.total).toBe(1500);
  });

  it("descarta invoices con project_id null (corporativas sin cliente)", () => {
    const l = computeLtv({
      settlements: [],
      invoices: [
        invoice({
          amount_gross: 999,
          tax_amount: 0,
          status: "cobrada",
          project_id: null,
        }),
      ],
      renewals: [],
      upsells: [],
    });
    expect(l.fromInvoices).toBe(0);
    expect(l.total).toBe(0);
  });

  it("descarta invoices no cobradas (emitida/vencida/anulada)", () => {
    const l = computeLtv({
      settlements: [],
      invoices: [
        invoice({ amount_gross: 1000, status: "emitida" }),
        invoice({ amount_gross: 1000, status: "vencida" }),
        invoice({ amount_gross: 1000, status: "anulada" }),
      ],
      renewals: [],
      upsells: [],
    });
    expect(l.fromInvoices).toBe(0);
  });
});

describe("computeLtv — renewals + upsells", () => {
  it("suma solo status='cobrada' en ambos", () => {
    const l = computeLtv({
      settlements: [],
      invoices: [],
      renewals: [
        renewal({ amount: 5000, status: "cobrada" }),
        renewal({ amount: 5000, status: "confirmada" }), // pipeline, no cuenta
        renewal({ amount: 5000, status: "perdida" }),
      ],
      upsells: [
        upsell({ amount: 2000, status: "cobrada" }),
        upsell({ amount: 2000, status: "facturada", closed_at: null }),
      ],
    });
    expect(l.fromRenewals).toBe(5000);
    expect(l.fromUpsells).toBe(2000);
    expect(l.total).toBe(7000);
  });
});

describe("computeLtv — combinado", () => {
  it("total = suma de los cuatro términos", () => {
    const l = computeLtv({
      settlements: [
        settlement({ kingrow_retained: 10_000, status: "liquidada" }),
      ],
      invoices: [
        invoice({ amount_gross: 1210, tax_amount: 210, status: "cobrada" }),
      ],
      renewals: [renewal({ amount: 5000, status: "cobrada" })],
      upsells: [upsell({ amount: 3000, status: "cobrada" })],
    });
    expect(l.fromSettlements).toBe(10_000);
    expect(l.fromInvoices).toBe(1000);
    expect(l.fromRenewals).toBe(5000);
    expect(l.fromUpsells).toBe(3000);
    expect(l.total).toBe(19_000);
  });

  it("cero inputs → todo cero", () => {
    const l = computeLtv({
      settlements: [],
      invoices: [],
      renewals: [],
      upsells: [],
    });
    expect(l.total).toBe(0);
  });
});
