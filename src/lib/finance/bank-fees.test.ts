import { describe, expect, it } from "vitest";

import { computeBankFees, type BankFeeRow, type FeeOrigin } from "./bank-fees";

function makeFee(overrides: Partial<BankFeeRow> = {}): BankFeeRow {
  return {
    movementId: "mv-fee-1",
    bankId: "bank-1",
    bankName: "Banco Uno",
    currency: "ARS",
    amount: 10,
    occurredAt: "2026-08-01",
    origin: "invoice",
    itemId: "inv-1",
    itemLabel: "F-001",
    principalAmount: 1000,
    ...overrides,
  };
}

describe("computeBankFees", () => {
  it("sin comisiones devuelve todo en cero y ratios null", () => {
    const r = computeBankFees({
      fees: [],
      cashInTotal: 5000,
      cashOutTotal: 3000,
    });
    expect(r.totalFees).toBe(0);
    expect(r.count).toBe(0);
    for (const origin of [
      "invoice",
      "expense",
      "payroll",
      "transfer",
    ] as FeeOrigin[]) {
      expect(r.byOrigin[origin].fees).toBe(0);
      expect(r.byOrigin[origin].count).toBe(0);
      expect(r.byOrigin[origin].ratioVsPrincipal).toBeNull();
    }
    expect(r.byBank).toEqual([]);
    expect(r.topFees).toEqual([]);
    expect(r.ratioVsCashOut).toBe(0 / 3000); // 0
    expect(r.ratioVsCashFlow).toBe(0 / 8000); // 0
  });

  it("agrega por origen y calcula ratio contra el principal", () => {
    const fees: BankFeeRow[] = [
      makeFee({ movementId: "m1", origin: "invoice", amount: 30, principalAmount: 1000 }),
      makeFee({ movementId: "m2", origin: "invoice", amount: 20, principalAmount: 500 }),
      makeFee({ movementId: "m3", origin: "expense", amount: 5, principalAmount: 100 }),
      makeFee({ movementId: "m4", origin: "payroll", amount: 8, principalAmount: 800 }),
      makeFee({ movementId: "m5", origin: "transfer", amount: 12, principalAmount: null }),
    ];
    const r = computeBankFees({
      fees,
      cashInTotal: 1000,
      cashOutTotal: 2000,
    });
    expect(r.totalFees).toBe(75);
    expect(r.count).toBe(5);

    expect(r.byOrigin.invoice.fees).toBe(50);
    expect(r.byOrigin.invoice.count).toBe(2);
    expect(r.byOrigin.invoice.principalTotal).toBe(1500);
    expect(r.byOrigin.invoice.ratioVsPrincipal).toBeCloseTo(50 / 1500);

    expect(r.byOrigin.expense.fees).toBe(5);
    expect(r.byOrigin.expense.ratioVsPrincipal).toBeCloseTo(5 / 100);

    expect(r.byOrigin.payroll.fees).toBe(8);
    expect(r.byOrigin.payroll.ratioVsPrincipal).toBeCloseTo(8 / 800);

    // principalAmount nulo → principalTotal = 0 → ratio null
    expect(r.byOrigin.transfer.fees).toBe(12);
    expect(r.byOrigin.transfer.principalTotal).toBe(0);
    expect(r.byOrigin.transfer.ratioVsPrincipal).toBeNull();
  });

  it("agrupa por banco y ordena por comisión descendente", () => {
    const fees: BankFeeRow[] = [
      makeFee({ movementId: "a1", bankId: "b1", bankName: "Banco Uno", amount: 10 }),
      makeFee({ movementId: "a2", bankId: "b1", bankName: "Banco Uno", amount: 15 }),
      makeFee({
        movementId: "b1x",
        bankId: "b2",
        bankName: "Banco Dos",
        currency: "USD",
        amount: 50,
      }),
    ];
    const r = computeBankFees({ fees, cashInTotal: 0, cashOutTotal: 0 });
    expect(r.byBank).toHaveLength(2);
    expect(r.byBank[0]!.bankId).toBe("b2");
    expect(r.byBank[0]!.fees).toBe(50);
    expect(r.byBank[0]!.currency).toBe("USD");
    expect(r.byBank[1]!.bankId).toBe("b1");
    expect(r.byBank[1]!.fees).toBe(25);
    expect(r.byBank[1]!.count).toBe(2);
  });

  it("ratios contra cashOut y cashFlow", () => {
    const r = computeBankFees({
      fees: [makeFee({ amount: 100 })],
      cashInTotal: 400,
      cashOutTotal: 600,
    });
    expect(r.ratioVsCashOut).toBeCloseTo(100 / 600);
    expect(r.ratioVsCashFlow).toBeCloseTo(100 / 1000);
  });

  it("ratios null cuando el denominador es 0", () => {
    const r = computeBankFees({
      fees: [makeFee({ amount: 100 })],
      cashInTotal: 0,
      cashOutTotal: 0,
    });
    expect(r.ratioVsCashOut).toBeNull();
    expect(r.ratioVsCashFlow).toBeNull();
  });

  it("topFees ordena descendente y trunca a 10", () => {
    const fees: BankFeeRow[] = Array.from({ length: 15 }, (_, i) =>
      makeFee({ movementId: `m${i}`, amount: i + 1 }),
    );
    const r = computeBankFees({ fees, cashInTotal: 0, cashOutTotal: 0 });
    expect(r.topFees).toHaveLength(10);
    expect(r.topFees[0]!.amount).toBe(15);
    expect(r.topFees[9]!.amount).toBe(6);
  });

  it("preserva el input original (no muta el array de fees)", () => {
    const fees: BankFeeRow[] = [
      makeFee({ movementId: "a", amount: 1 }),
      makeFee({ movementId: "b", amount: 3 }),
      makeFee({ movementId: "c", amount: 2 }),
    ];
    const before = fees.map((f) => f.movementId);
    computeBankFees({ fees, cashInTotal: 0, cashOutTotal: 0 });
    expect(fees.map((f) => f.movementId)).toEqual(before);
  });
});
