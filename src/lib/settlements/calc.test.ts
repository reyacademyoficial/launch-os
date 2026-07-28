import { describe, expect, it } from "vitest";

import { computeSettlement } from "./calc";
import type { SettlementRuleSnapshot } from "./types";

/**
 * Helper para armar snapshots limpios en cada test — evita repetir los
 * campos irrelevantes y hace obvio qué componente estamos ejercitando.
 */
function snapshot(
  overrides: Partial<SettlementRuleSnapshot> = {},
): SettlementRuleSnapshot {
  return {
    name: "test",
    percent_of_collected: 0,
    fixed_fee_per_launch: 0,
    fixed_fee_per_sale: 0,
    min_guarantee: null,
    applies_on: "collected",
    ...overrides,
  };
}

describe("computeSettlement — casos del Bloque 1", () => {
  it("PROPIA: percent=100 → Kingrow retiene todo, cliente 0", () => {
    // Regla operativa de una empresa propia (Growins, Rey Academy).
    const rule = snapshot({ percent_of_collected: 100 });
    const r = computeSettlement(rule, {
      collectedTotal: 10_000,
      totalSold: 12_000,
      salesCount: 5,
    });
    expect(r.kingrowRetained).toBe(10_000);
    expect(r.owedToClient).toBe(0);
  });

  it("EXTERNA: percent=30 → 30% a Kingrow, 70% al cliente", () => {
    const rule = snapshot({ percent_of_collected: 30 });
    const r = computeSettlement(rule, {
      collectedTotal: 10_000,
      totalSold: 10_000,
      salesCount: 1,
    });
    expect(r.kingrowRetained).toBe(3_000);
    expect(r.owedToClient).toBe(7_000);
  });

  it("min_guarantee kicks in cuando el % da menos que el piso", () => {
    // %×collected = 500, piso = 2000 → Kingrow se queda 2000 (piso ganó).
    // owed = 10000 − 2000 = 8000.
    const rule = snapshot({
      percent_of_collected: 5,
      min_guarantee: 2_000,
    });
    const r = computeSettlement(rule, {
      collectedTotal: 10_000,
      totalSold: 10_000,
      salesCount: 1,
    });
    expect(r.percentPart).toBe(500);
    expect(r.retainedAfterGuarantee).toBe(2_000);
    expect(r.kingrowRetained).toBe(2_000);
    expect(r.owedToClient).toBe(8_000);
  });

  it("min_guarantee NO se aplica cuando el % ya lo supera", () => {
    // %×collected = 3000, piso = 500 → gana el %.
    const rule = snapshot({
      percent_of_collected: 30,
      min_guarantee: 500,
    });
    const r = computeSettlement(rule, {
      collectedTotal: 10_000,
      totalSold: 10_000,
      salesCount: 1,
    });
    expect(r.retainedAfterGuarantee).toBe(3_000);
    expect(r.kingrowRetained).toBe(3_000);
    expect(r.owedToClient).toBe(7_000);
  });

  it("Cap duro: retención NUNCA > collectedTotal (aun con piso enorme)", () => {
    // Piso 20k, cobrado 3k → retención cap a 3k, cliente 0.
    const rule = snapshot({
      percent_of_collected: 30,
      min_guarantee: 20_000,
    });
    const r = computeSettlement(rule, {
      collectedTotal: 3_000,
      totalSold: 5_000,
      salesCount: 1,
    });
    expect(r.retainedAfterGuarantee).toBe(20_000);
    expect(r.kingrowRetained).toBe(3_000);
    expect(r.owedToClient).toBe(0);
  });

  it("Componentes se SUMAN: percent + fixed_launch + fixed_sale × N", () => {
    // 10% de 10k = 1000
    // fixed_fee_per_launch = 200
    // fixed_fee_per_sale = 50 × 4 sales = 200
    // total = 1400
    const rule = snapshot({
      percent_of_collected: 10,
      fixed_fee_per_launch: 200,
      fixed_fee_per_sale: 50,
    });
    const r = computeSettlement(rule, {
      collectedTotal: 10_000,
      totalSold: 10_000,
      salesCount: 4,
    });
    expect(r.percentPart).toBe(1_000);
    expect(r.fixedLaunchPart).toBe(200);
    expect(r.fixedSalePart).toBe(200);
    expect(r.rawRetention).toBe(1_400);
    expect(r.kingrowRetained).toBe(1_400);
    expect(r.owedToClient).toBe(8_600);
  });

  it("applies_on='sold': base = totalSold (aun si cobrado difiere)", () => {
    // 20% sobre pactado (12k) = 2400, aunque cobrado es 10k.
    // Cap: 2400 ≤ 10000 → retención = 2400. Cliente = 10000 − 2400 = 7600.
    // Nota: el cap sigue siendo contra collectedTotal (plata real que entró),
    // no contra la base. Es intencional: nunca retenés más que lo que hay.
    const rule = snapshot({
      percent_of_collected: 20,
      applies_on: "sold",
    });
    const r = computeSettlement(rule, {
      collectedTotal: 10_000,
      totalSold: 12_000,
      salesCount: 3,
    });
    expect(r.base).toBe(12_000);
    expect(r.percentPart).toBe(2_400);
    expect(r.kingrowRetained).toBe(2_400);
    expect(r.owedToClient).toBe(7_600);
  });

  it("collectedTotal=0: retención=0, owed=0 (no hay plata que repartir)", () => {
    const rule = snapshot({
      percent_of_collected: 30,
      fixed_fee_per_launch: 500,
      fixed_fee_per_sale: 100,
      min_guarantee: 1_000,
    });
    const r = computeSettlement(rule, {
      collectedTotal: 0,
      totalSold: 0,
      salesCount: 0,
    });
    expect(r.kingrowRetained).toBe(0);
    expect(r.owedToClient).toBe(0);
  });

  it("INVARIANTE: kingrowRetained + owedToClient = collectedTotal (siempre)", () => {
    // Fuzz-ish: mezcla de configs; el invariante debe cumplirse en todas.
    const cases: Array<{
      rule: SettlementRuleSnapshot;
      inputs: { collectedTotal: number; totalSold: number; salesCount: number };
    }> = [
      {
        rule: snapshot({ percent_of_collected: 100 }),
        inputs: { collectedTotal: 5_000, totalSold: 5_000, salesCount: 2 },
      },
      {
        rule: snapshot({ percent_of_collected: 0 }),
        inputs: { collectedTotal: 5_000, totalSold: 5_000, salesCount: 2 },
      },
      {
        rule: snapshot({
          percent_of_collected: 15,
          fixed_fee_per_launch: 300,
          fixed_fee_per_sale: 75,
          min_guarantee: 800,
        }),
        inputs: { collectedTotal: 9_876.54, totalSold: 12_000, salesCount: 3 },
      },
      {
        rule: snapshot({
          percent_of_collected: 50,
          min_guarantee: 999_999,
        }),
        inputs: { collectedTotal: 100, totalSold: 100, salesCount: 1 },
      },
    ];
    for (const { rule, inputs } of cases) {
      const r = computeSettlement(rule, inputs);
      expect(r.kingrowRetained + r.owedToClient).toBeCloseTo(
        inputs.collectedTotal,
        10,
      );
      expect(r.kingrowRetained).toBeLessThanOrEqual(inputs.collectedTotal);
      expect(r.owedToClient).toBeGreaterThanOrEqual(0);
    }
  });
});
