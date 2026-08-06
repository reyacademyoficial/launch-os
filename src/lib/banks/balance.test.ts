import { describe, expect, it } from "vitest";

import { computeBankBalances } from "./balance";
import type { BankMovementRow, BankRow } from "./types";

function makeBank(overrides: Partial<BankRow> = {}): BankRow {
  return {
    id: "bank-1",
    organization_id: "org-1",
    project_id: null,
    name: "Banco Test",
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

describe("computeBankBalances", () => {
  it("balance sin movimientos es opening_balance", () => {
    const b = makeBank({ opening_balance: 1_000 });
    const balances = computeBankBalances([b], []);
    expect(balances.get(b.id)?.total).toBe(1_000);
    expect(balances.get(b.id)?.movementsIn).toBe(0);
    expect(balances.get(b.id)?.movementsOut).toBe(0);
  });

  it("suma ingresos, resta egresos", () => {
    const b = makeBank({ opening_balance: 500 });
    const movs = [
      makeMovement({ id: "m-in-1", kind: "in", amount: 300 }),
      makeMovement({ id: "m-in-2", kind: "in", amount: 200 }),
      makeMovement({ id: "m-out-1", kind: "out", amount: 100 }),
    ];
    const bal = computeBankBalances([b], movs).get(b.id);
    expect(bal?.movementsIn).toBe(500);
    expect(bal?.movementsOut).toBe(100);
    expect(bal?.total).toBe(900);
  });

  it("movimientos apuntando a otro banco son ignorados", () => {
    const b = makeBank({ opening_balance: 100 });
    const movs = [
      makeMovement({ bank_id: "otro-banco", kind: "in", amount: 999 }),
    ];
    expect(computeBankBalances([b], movs).get(b.id)?.total).toBe(100);
  });

  it("parsea opening_balance y amount desde string (numeric de PG)", () => {
    const b = makeBank({ opening_balance: "250.5" as unknown as number });
    const movs = [
      makeMovement({ kind: "in", amount: "100.25" as unknown as number }),
    ];
    expect(computeBankBalances([b], movs).get(b.id)?.total).toBe(350.75);
  });
});
