import { describe, expect, it } from "vitest";

import { buildBankReport } from "./bank-report";
import type { BankMovementRow, BankRow } from "@/lib/banks/types";

function makeBank(overrides: Partial<BankRow> = {}): BankRow {
  return {
    id: "bank-1",
    organization_id: "org-1",
    project_id: null,
    name: "Banco Uno",
    opening_balance: 0,
    currency: "ARS",
    active: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeMovement(
  overrides: Partial<BankMovementRow> = {},
): BankMovementRow {
  return {
    id: "mv-1",
    bank_id: "bank-1",
    organization_id: "org-1",
    kind: "in",
    amount: 0,
    occurred_at: "2026-08-01",
    description: null,
    created_by: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

describe("buildBankReport", () => {
  it("banco sin movimientos: opening=closing, net=0", () => {
    const b = makeBank({ opening_balance: 500 });
    const rep = buildBankReport([b], []);
    expect(rep.byBank).toHaveLength(1);
    expect(rep.byBank[0]).toMatchObject({
      bankId: "bank-1",
      opening: 500,
      movementsIn: 0,
      movementsOut: 0,
      net: 0,
      closing: 500,
      movementCount: 0,
    });
  });

  it("agrega ingresos y egresos por banco + consolidado", () => {
    const b = makeBank({ opening_balance: 1000 });
    const movs = [
      makeMovement({ id: "m1", kind: "in", amount: 500 }),
      makeMovement({ id: "m2", kind: "in", amount: 200 }),
      makeMovement({ id: "m3", kind: "out", amount: 300 }),
    ];
    const rep = buildBankReport([b], movs);
    expect(rep.byBank[0]).toMatchObject({
      movementsIn: 700,
      movementsOut: 300,
      net: 400,
      closing: 1400,
      movementCount: 3,
    });
    expect(rep.consolidated).toHaveLength(1);
    expect(rep.consolidated[0]).toMatchObject({
      currency: "ARS",
      opening: 1000,
      closing: 1400,
    });
  });

  it("consolidado separa ARS y USD", () => {
    const b1 = makeBank({ id: "b1", currency: "ARS", opening_balance: 100 });
    const b2 = makeBank({ id: "b2", currency: "USD", opening_balance: 50 });
    const rep = buildBankReport([b1, b2], []);
    expect(rep.consolidated).toHaveLength(2);
    const ars = rep.consolidated.find((c) => c.currency === "ARS");
    const usd = rep.consolidated.find((c) => c.currency === "USD");
    expect(ars?.opening).toBe(100);
    expect(usd?.opening).toBe(50);
  });

  it("linkedMovementIds separa conciliados de no conciliados", () => {
    const b = makeBank();
    const movs = [
      makeMovement({ id: "m1", kind: "in", amount: 100 }),
      makeMovement({ id: "m2", kind: "out", amount: 50 }),
      makeMovement({ id: "m3", kind: "in", amount: 30 }),
    ];
    const rep = buildBankReport([b], movs, new Set(["m1", "m2"]));
    expect(rep.byBank[0]?.linkedCount).toBe(2);
    expect(rep.byBank[0]?.unconciledCount).toBe(1);
  });

  it("movimientos apuntando a otro banco son ignorados", () => {
    const b = makeBank({ opening_balance: 100 });
    const movs = [
      makeMovement({ bank_id: "otro", kind: "in", amount: 999 }),
    ];
    expect(buildBankReport([b], movs).byBank[0]?.closing).toBe(100);
  });
});
