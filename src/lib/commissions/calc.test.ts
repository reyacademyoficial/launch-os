import { describe, it, expect } from "vitest";

import { computeCommission, findApplicableRule } from "./calc";
import type { CommissionRuleRow, PaymentRow, SaleRow } from "./types";

function rule(overrides: Partial<CommissionRuleRow> = {}): CommissionRuleRow {
  return {
    id: "rule-1",
    project_id: "p-1",
    payment_modality_id: "mod-1",
    launch_id: null,
    type: "percent",
    value: 10,
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
    ...overrides,
  };
}

function sale(overrides: Partial<SaleRow> = {}): SaleRow {
  return {
    id: "sale-1",
    project_id: "p-1",
    lead_id: "lead-1",
    team_member_id: "tm-1",
    payment_modality_id: "mod-1",
    total_amount: 1000,
    closed_at: "2026-06-10T00:00:00Z",
    created_at: "2026-06-10T00:00:00Z",
    updated_at: "2026-06-10T00:00:00Z",
    ...overrides,
  };
}

function payment(amount: number): PaymentRow {
  return {
    id: `pay-${Math.random()}`,
    sale_id: "sale-1",
    amount,
    paid_at: "2026-06-11",
    notes: null,
    created_at: "2026-06-11T00:00:00Z",
    updated_at: "2026-06-11T00:00:00Z",
  };
}

describe("computeCommission — percent", () => {
  it("0 cobros → comisión 0 (con la regla puesta)", () => {
    const r = rule({ type: "percent", value: 10 });
    const result = computeCommission(sale({ total_amount: 1000 }), [], r);
    expect(result.commission).toBe(0);
    expect(result.collected).toBe(0);
  });

  it("cobro total → percent × total", () => {
    const r = rule({ type: "percent", value: 10 });
    const result = computeCommission(
      sale({ total_amount: 1000 }),
      [payment(1000)],
      r,
    );
    expect(result.commission).toBe(100);
    expect(result.collected).toBe(1000);
  });

  it("cobros parciales → percent × suma cobrada", () => {
    const r = rule({ type: "percent", value: 20 });
    const result = computeCommission(
      sale({ total_amount: 1000 }),
      [payment(300), payment(200)],
      r,
    );
    // 500 cobrado × 20% = 100
    expect(result.commission).toBe(100);
  });
});

describe("computeCommission — fixed (proporcional)", () => {
  it("0 cobros → 0", () => {
    const r = rule({ type: "fixed", value: 500 });
    const result = computeCommission(sale({ total_amount: 1000 }), [], r);
    expect(result.commission).toBe(0);
  });

  it("cobro total → value entero", () => {
    const r = rule({ type: "fixed", value: 500 });
    const result = computeCommission(
      sale({ total_amount: 1000 }),
      [payment(1000)],
      r,
    );
    expect(result.commission).toBe(500);
  });

  it("cobro parcial → value × ratio", () => {
    const r = rule({ type: "fixed", value: 600 });
    const result = computeCommission(
      sale({ total_amount: 1000 }),
      [payment(250)],
      r,
    );
    // 250/1000 = 0.25 → 600 * 0.25 = 150
    expect(result.commission).toBe(150);
  });

  it("sobrecobro (cobrado > pactado) → cap a value", () => {
    const r = rule({ type: "fixed", value: 500 });
    const result = computeCommission(
      sale({ total_amount: 1000 }),
      [payment(1500)],
      r,
    );
    // ratio capeado a 1 → 500 max
    expect(result.commission).toBe(500);
  });

  it("total pactado = 0 → comisión 0 (evita ÷0)", () => {
    const r = rule({ type: "fixed", value: 500 });
    const result = computeCommission(
      sale({ total_amount: 0 }),
      [payment(100)],
      r,
    );
    expect(result.commission).toBe(0);
  });
});

describe("computeCommission — sin regla", () => {
  it("rule = null → comisión 0 y formula = 'Configurar regla'", () => {
    const result = computeCommission(
      sale({ total_amount: 1000 }),
      [payment(500)],
      null,
    );
    expect(result.commission).toBe(0);
    expect(result.formula).toBe("Configurar regla");
    expect(result.collected).toBe(500);
  });
});

describe("findApplicableRule — prioridad launch override > default", () => {
  const defaultRule = rule({
    id: "r-default",
    payment_modality_id: "mod-1",
    launch_id: null,
    type: "percent",
    value: 10,
  });
  const launchOverride = rule({
    id: "r-launch",
    payment_modality_id: "mod-1",
    launch_id: "launch-X",
    type: "fixed",
    value: 999,
  });

  it("lead sin launch → default", () => {
    const found = findApplicableRule([defaultRule, launchOverride], "mod-1", null);
    expect(found?.id).toBe("r-default");
  });

  it("lead con launch que tiene override → override", () => {
    const found = findApplicableRule([defaultRule, launchOverride], "mod-1", "launch-X");
    expect(found?.id).toBe("r-launch");
  });

  it("lead con launch SIN override → cae a default", () => {
    const found = findApplicableRule([defaultRule, launchOverride], "mod-1", "launch-Y");
    expect(found?.id).toBe("r-default");
  });

  it("modalidad sin reglas → null", () => {
    const found = findApplicableRule([defaultRule], "mod-otra", null);
    expect(found).toBeNull();
  });

  it("array vacío → null", () => {
    const found = findApplicableRule([], "mod-1", null);
    expect(found).toBeNull();
  });
});
