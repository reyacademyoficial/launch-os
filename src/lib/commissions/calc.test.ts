import { describe, it, expect } from "vitest";

import { normalizePaymentsForSaleCurrency } from "@/lib/money/commission-normalize";
import type { FxLookup } from "@/lib/money/sales-context";

import { computeCommission, findApplicableRule, findTierForRank } from "./calc";
import type {
  CommissionRuleRow,
  CommissionRuleTierRow,
  PaymentRow,
  SaleRow,
} from "./types";

const TS = "2026-06-01T00:00:00Z";

function tier(overrides: Partial<CommissionRuleTierRow> = {}): CommissionRuleTierRow {
  return {
    id: `tier-${Math.random()}`,
    rule_id: "rule-1",
    min_count: 0,
    max_count: null,
    type: "percent",
    value: 10,
    currency: "ARS",
    created_at: TS,
    updated_at: TS,
    ...overrides,
  };
}

function rule(overrides: Partial<CommissionRuleRow> = {}): CommissionRuleRow {
  return {
    id: "rule-1",
    project_id: "p-1",
    launch_id: null,
    product_id: null,
    accrual_mode: "proportional",
    threshold_type: null,
    threshold_value: null,
    modality_ids: ["mod-1"],
    tiers: [tier()],
    created_at: TS,
    updated_at: TS,
    ...overrides,
  };
}

function sale(overrides: Partial<SaleRow> = {}): SaleRow {
  return {
    id: "sale-1",
    project_id: "p-1",
    lead_id: "lead-1",
    launch_id: null,
    team_member_id: "tm-1",
    payment_modality_id: "mod-1",
    product_id: "prod-1",
    total_amount: 1000,
    currency: "ARS",
    closed_at: "2026-06-10T00:00:00Z",
    installment_count: 1,
    installment_frequency: "single",
    grace_days: 5,
    commission_rule_snapshot: null,
    created_at: TS,
    updated_at: TS,
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
    installment_id: null,
    payment_method_id: null,
    original_currency: null,
    created_at: TS,
    updated_at: TS,
  };
}

// ────────────────────────────────────────────────────────────────────────────
//   PROPORTIONAL (modelo previo) — equivalente a una regla con 1 tier
// ────────────────────────────────────────────────────────────────────────────
describe("computeCommission — proportional / percent", () => {
  it("0 cobros → comisión 0", () => {
    const r = rule({ tiers: [tier({ type: "percent", value: 10 })] });
    const result = computeCommission(sale({ total_amount: 1000 }), [], r, 0);
    expect(result.commission).toBe(0);
    expect(result.collected).toBe(0);
    expect(result.released).toBe(true); // proportional siempre released
  });

  it("cobro total → percent × cobrado", () => {
    const r = rule({ tiers: [tier({ type: "percent", value: 10 })] });
    const result = computeCommission(
      sale({ total_amount: 1000 }),
      [payment(1000)],
      r,
      0,
    );
    expect(result.commission).toBe(100);
  });

  it("cobros parciales → percent × suma cobrada", () => {
    const r = rule({ tiers: [tier({ type: "percent", value: 20 })] });
    const result = computeCommission(
      sale({ total_amount: 1000 }),
      [payment(300), payment(200)],
      r,
      0,
    );
    expect(result.commission).toBe(100); // 500 × 20%
  });
});

describe("computeCommission — proportional / fixed", () => {
  it("cobro parcial → value × ratio", () => {
    const r = rule({ tiers: [tier({ type: "fixed", value: 600 })] });
    const result = computeCommission(
      sale({ total_amount: 1000 }),
      [payment(250)],
      r,
      0,
    );
    expect(result.commission).toBe(150); // 600 × 0.25
  });

  it("sobrecobro → cap a value", () => {
    const r = rule({ tiers: [tier({ type: "fixed", value: 500 })] });
    const result = computeCommission(
      sale({ total_amount: 1000 }),
      [payment(1500)],
      r,
      0,
    );
    expect(result.commission).toBe(500);
  });

  it("pledged = 0 → 0", () => {
    const r = rule({ tiers: [tier({ type: "fixed", value: 500 })] });
    const result = computeCommission(
      sale({ total_amount: 0 }),
      [payment(100)],
      r,
      0,
    );
    expect(result.commission).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
//   commissionCurrency (migración 0107) — la moneda del tier fixed manda,
//   la del sale sólo aplica a percent. Bug reportado: sin currency en el
//   tier, un tier "500 ARS" aparecía como "US$ 500" en ventas USD.
// ────────────────────────────────────────────────────────────────────────────
describe("computeCommission — commissionCurrency", () => {
  it("percent hereda la moneda de la venta (USD)", () => {
    const r = rule({
      tiers: [tier({ type: "percent", value: 10, currency: "ARS" })],
    });
    const result = computeCommission(
      sale({ total_amount: 1000, currency: "USD" }),
      [payment(1000)],
      r,
      0,
    );
    expect(result.commission).toBe(100);
    expect(result.commissionCurrency).toBe("USD");
  });

  it("fixed ARS + venta USD → moneda del tier (ARS), sin conversión", () => {
    const r = rule({
      tiers: [tier({ type: "fixed", value: 500, currency: "ARS" })],
    });
    const result = computeCommission(
      sale({ total_amount: 1000, currency: "USD" }),
      [payment(1000)],
      r,
      0,
    );
    expect(result.commission).toBe(500);
    expect(result.commissionCurrency).toBe("ARS");
  });

  it("fixed USD + venta ARS → moneda del tier (USD)", () => {
    const r = rule({
      tiers: [tier({ type: "fixed", value: 50, currency: "USD" })],
    });
    const result = computeCommission(
      sale({ total_amount: 1000, currency: "ARS" }),
      [payment(1000)],
      r,
      0,
    );
    expect(result.commission).toBe(50);
    expect(result.commissionCurrency).toBe("USD");
  });

  it("snapshot pre-0107 sin currency defaultea a ARS", () => {
    const result = computeCommission(
      sale({
        total_amount: 1000,
        currency: "USD",
        commission_rule_snapshot: {
          accrual_mode: "proportional",
          threshold_type: null,
          threshold_value: null,
          tiers: [
            { min_count: 0, max_count: null, type: "fixed", value: 500 },
          ],
        },
      }),
      [payment(1000)],
      null,
      0,
    );
    expect(result.commission).toBe(500);
    expect(result.commissionCurrency).toBe("ARS");
  });
});

// ────────────────────────────────────────────────────────────────────────────
//   THRESHOLD_FULL — "no doy comisión hasta cuota 3, después 4% del total"
// ────────────────────────────────────────────────────────────────────────────
describe("computeCommission — threshold_full / payment_count", () => {
  const r = rule({
    accrual_mode: "threshold_full",
    threshold_type: "payment_count",
    threshold_value: 3,
    tiers: [tier({ type: "percent", value: 4 })],
  });

  it("1 cobro → 0 (no llegó al umbral)", () => {
    const result = computeCommission(
      sale({ total_amount: 1800 }),
      [payment(300)],
      r,
      0,
    );
    expect(result.released).toBe(false);
    expect(result.commission).toBe(0);
  });

  it("2 cobros → 0 (todavía no)", () => {
    const result = computeCommission(
      sale({ total_amount: 1800 }),
      [payment(300), payment(300)],
      r,
      0,
    );
    expect(result.commission).toBe(0);
  });

  it("3 cobros → 4% del TOTAL pactado, no del cobrado", () => {
    const result = computeCommission(
      sale({ total_amount: 1800 }),
      [payment(300), payment(300), payment(300)],
      r,
      0,
    );
    expect(result.released).toBe(true);
    expect(result.commission).toBe(72); // 1800 × 4%
  });

  it("4 cobros → sigue 4% del total (no escala con cobros adicionales)", () => {
    const result = computeCommission(
      sale({ total_amount: 1800 }),
      [payment(300), payment(300), payment(300), payment(300)],
      r,
      0,
    );
    expect(result.commission).toBe(72);
  });
});

describe("computeCommission — threshold_full / paid_ratio", () => {
  const r = rule({
    accrual_mode: "threshold_full",
    threshold_type: "paid_ratio",
    threshold_value: 0.5,
    tiers: [tier({ type: "percent", value: 5 })],
  });

  it("cobrado 49% → 0", () => {
    const result = computeCommission(
      sale({ total_amount: 1000 }),
      [payment(490)],
      r,
      0,
    );
    expect(result.commission).toBe(0);
  });

  it("cobrado 50% exacto → libera 5% sobre 1000 = 50", () => {
    const result = computeCommission(
      sale({ total_amount: 1000 }),
      [payment(500)],
      r,
      0,
    );
    expect(result.released).toBe(true);
    expect(result.commission).toBe(50);
  });

  it("pledged 0 → no libera (evita ÷0)", () => {
    const result = computeCommission(
      sale({ total_amount: 0 }),
      [payment(100)],
      r,
      0,
    );
    expect(result.commission).toBe(0);
  });
});

describe("computeCommission — threshold_full / fixed", () => {
  it("al cruzar, libera value entero", () => {
    const r = rule({
      accrual_mode: "threshold_full",
      threshold_type: "payment_count",
      threshold_value: 2,
      tiers: [tier({ type: "fixed", value: 200 })],
    });
    const before = computeCommission(sale(), [payment(100)], r, 0);
    expect(before.commission).toBe(0);
    const after = computeCommission(sale(), [payment(100), payment(100)], r, 0);
    expect(after.commission).toBe(200);
  });
});

// ────────────────────────────────────────────────────────────────────────────
//   THRESHOLD_PROPORTIONAL — abre con umbral, después proporcional al cobrado
// ────────────────────────────────────────────────────────────────────────────
describe("computeCommission — threshold_proportional", () => {
  const r = rule({
    accrual_mode: "threshold_proportional",
    threshold_type: "payment_count",
    threshold_value: 2,
    tiers: [tier({ type: "percent", value: 10 })],
  });

  it("antes del umbral → 0", () => {
    const result = computeCommission(sale(), [payment(300)], r, 0);
    expect(result.commission).toBe(0);
  });

  it("cruzado el umbral → percent × cobrado (no × total)", () => {
    const result = computeCommission(
      sale({ total_amount: 1000 }),
      [payment(300), payment(300)],
      r,
      0,
    );
    expect(result.commission).toBe(60); // 600 × 10%
  });
});

// ────────────────────────────────────────────────────────────────────────────
//   TIERS MARGINALES — se elige el tier según rank de la venta en el launch
// ────────────────────────────────────────────────────────────────────────────
describe("findTierForRank", () => {
  const tiers: CommissionRuleTierRow[] = [
    tier({ id: "t-0-4", min_count: 0, max_count: 4, value: 10 }),
    tier({ id: "t-5-9", min_count: 5, max_count: 9, value: 15 }),
    tier({ id: "t-10-up", min_count: 10, max_count: null, value: 20 }),
  ];

  it("rank 0 → 1er tier (0..4)", () => {
    expect(findTierForRank(tiers, 0)?.id).toBe("t-0-4");
  });
  it("rank 4 → 1er tier (límite inclusive)", () => {
    expect(findTierForRank(tiers, 4)?.id).toBe("t-0-4");
  });
  it("rank 5 → 2do tier", () => {
    expect(findTierForRank(tiers, 5)?.id).toBe("t-5-9");
  });
  it("rank 10 → tier final (sin techo)", () => {
    expect(findTierForRank(tiers, 10)?.id).toBe("t-10-up");
  });
  it("rank 999 → tier final", () => {
    expect(findTierForRank(tiers, 999)?.id).toBe("t-10-up");
  });
  it("hueco en la config (rank cae afuera) → null", () => {
    const gapTiers = [tier({ min_count: 0, max_count: 4 })]; // no hay nada después
    expect(findTierForRank(gapTiers, 5)).toBeNull();
  });
});

describe("computeCommission — tier por rank cambia el %", () => {
  const r = rule({
    tiers: [
      tier({ id: "t-low", min_count: 0, max_count: 4, type: "percent", value: 10 }),
      tier({ id: "t-high", min_count: 5, max_count: null, type: "percent", value: 20 }),
    ],
  });

  it("venta #1 (rank=0) usa tier bajo", () => {
    const result = computeCommission(sale(), [payment(1000)], r, 0);
    expect(result.tier?.id).toBe("t-low");
    expect(result.commission).toBe(100);
  });
  it("venta #6 (rank=5) usa tier alto", () => {
    const result = computeCommission(sale(), [payment(1000)], r, 5);
    expect(result.tier?.id).toBe("t-high");
    expect(result.commission).toBe(200);
  });
});

// ────────────────────────────────────────────────────────────────────────────
//   findApplicableRule — M:N vía modality_ids + prioridad launch
// ────────────────────────────────────────────────────────────────────────────
describe("findApplicableRule", () => {
  const defaultRule = rule({
    id: "r-default",
    launch_id: null,
    modality_ids: ["mod-1", "mod-2"],
  });
  const launchOverride = rule({
    id: "r-override",
    launch_id: "launch-X",
    modality_ids: ["mod-1"],
  });

  it("lead sin launch → default", () => {
    const found = findApplicableRule([defaultRule, launchOverride], "mod-1", null);
    expect(found?.id).toBe("r-default");
  });

  it("lead con launch matcheado → override", () => {
    const found = findApplicableRule(
      [defaultRule, launchOverride],
      "mod-1",
      "launch-X",
    );
    expect(found?.id).toBe("r-override");
  });

  it("lead con launch sin override → cae a default", () => {
    const found = findApplicableRule(
      [defaultRule, launchOverride],
      "mod-1",
      "launch-Y",
    );
    expect(found?.id).toBe("r-default");
  });

  it("la regla aplica a varias modalidades", () => {
    const found = findApplicableRule([defaultRule], "mod-2", null);
    expect(found?.id).toBe("r-default");
  });

  it("modalidad no listada → null", () => {
    const found = findApplicableRule([defaultRule], "mod-otra", null);
    expect(found).toBeNull();
  });
});

describe("computeCommission — sin regla / sin tier", () => {
  it("rule = null → 0 con formula 'Configurar regla'", () => {
    const result = computeCommission(sale(), [payment(500)], null, 0);
    expect(result.commission).toBe(0);
    expect(result.formula).toBe("Configurar regla");
  });
});

// ────────────────────────────────────────────────────────────────────────────
//   Postgres `numeric` → string (PostgREST). El calc tiene que coercionar,
//   sino los reduce/aritméticas concatenan strings y devuelven NaN.
//   Regresión: leaderboard mostraba comisiones en 0 para setters con ventas
//   multi-cobro.
// ────────────────────────────────────────────────────────────────────────────
describe("computeCommission — numeric como string (postgrest)", () => {
  it("varios cobros como string → suma numérica, no concatenación", () => {
    const r = rule({ tiers: [tier({ type: "percent", value: 10 as unknown as number }) ] });
    const result = computeCommission(
      sale({ total_amount: "1000" as unknown as number }),
      [
        payment("300" as unknown as number),
        payment("200" as unknown as number),
        payment("100" as unknown as number),
      ],
      r,
      0,
    );
    expect(result.collected).toBe(600);
    expect(result.commission).toBe(60); // 600 × 10%
  });

  it("threshold_full con strings — paga full del pledged en number", () => {
    const r = rule({
      accrual_mode: "threshold_full",
      threshold_type: "payment_count",
      threshold_value: "2" as unknown as number,
      tiers: [tier({ type: "fixed", value: "500" as unknown as number })],
    });
    const result = computeCommission(
      sale({ total_amount: "1000" as unknown as number }),
      [
        payment("400" as unknown as number),
        payment("600" as unknown as number),
      ],
      r,
      0,
    );
    expect(result.released).toBe(true);
    expect(result.commission).toBe(500);
  });
});

// ────────────────────────────────────────────────────────────────────────────
//   normalizePaymentsForSaleCurrency — pre-conversión mixed-currency
//   Contrato del helper: entregar `computeCommission` payments en la MISMA
//   moneda que sale.total_amount. Bug post-migración 0106.
// ────────────────────────────────────────────────────────────────────────────
describe("normalizePaymentsForSaleCurrency", () => {
  function pay(id: string, amount: number): { id: string; amount: number } {
    return { id, amount };
  }

  it("sin fxLookup → passthrough, hasMixed=false", () => {
    const s = { id: "s-1", total_amount: 1000, currency: "ARS" as const };
    const payments = [pay("p-1", 300), pay("p-2", 200)];
    const result = normalizePaymentsForSaleCurrency(s, payments, undefined);
    expect(result.hasMixed).toBe(false);
    expect(result.normalized.map((n) => n.amount)).toEqual([300, 200]);
  });

  it("todos los payments en misma currency que sale → passthrough", () => {
    const s = { id: "s-1", total_amount: 1000, currency: "ARS" as const };
    const lookup: FxLookup = {
      bySaleId: { "s-1": { currency: "ARS", totalUsd: 1 } },
      byPaymentId: {
        "p-1": { currency: "ARS", amountUsd: 0.3 },
        "p-2": { currency: "ARS", amountUsd: 0.2 },
      },
    };
    const result = normalizePaymentsForSaleCurrency(
      s,
      [pay("p-1", 300), pay("p-2", 200)],
      lookup,
    );
    expect(result.hasMixed).toBe(false);
    expect(result.normalized.map((n) => n.amount)).toEqual([300, 200]);
  });

  it("sale ARS + 1 payment USD → convierte via tasa derivada del sale", () => {
    // Sale: 1_000_000 ARS con totalUsd=1000 → tasa efectiva 1000 ARS/USD.
    // Payment USD de 50 → 50 * 1000 = 50_000 ARS.
    const s = { id: "s-1", total_amount: 1_000_000, currency: "ARS" as const };
    const lookup: FxLookup = {
      bySaleId: { "s-1": { currency: "ARS", totalUsd: 1000 } },
      byPaymentId: {
        "p-ars": { currency: "ARS", amountUsd: 100 },
        "p-usd": { currency: "USD", amountUsd: 50 },
      },
    };
    const result = normalizePaymentsForSaleCurrency(
      s,
      [pay("p-ars", 100_000), pay("p-usd", 50)],
      lookup,
    );
    expect(result.hasMixed).toBe(false);
    expect(result.normalized[0]!.amount).toBe(100_000);
    expect(result.normalized[1]!.amount).toBeCloseTo(50_000, 5);
  });

  it("sale USD + 1 payment ARS → normalized.amount = amountUsd", () => {
    const s = { id: "s-1", total_amount: 500, currency: "USD" as const };
    const lookup: FxLookup = {
      bySaleId: { "s-1": { currency: "USD", totalUsd: 500 } },
      byPaymentId: {
        "p-usd": { currency: "USD", amountUsd: 200 },
        "p-ars": { currency: "ARS", amountUsd: 100 },
      },
    };
    const result = normalizePaymentsForSaleCurrency(
      s,
      [pay("p-usd", 200), pay("p-ars", 100_000)],
      lookup,
    );
    expect(result.hasMixed).toBe(false);
    expect(result.normalized[0]!.amount).toBe(200);
    expect(result.normalized[1]!.amount).toBe(100);
  });

  it("sale ARS con totalUsd=null → hasMixed=true, amount original", () => {
    const s = { id: "s-1", total_amount: 1_000_000, currency: "ARS" as const };
    const lookup: FxLookup = {
      bySaleId: { "s-1": { currency: "ARS", totalUsd: null } },
      byPaymentId: {
        "p-usd": { currency: "USD", amountUsd: 50 },
      },
    };
    const result = normalizePaymentsForSaleCurrency(
      s,
      [pay("p-usd", 50)],
      lookup,
    );
    expect(result.hasMixed).toBe(true);
    expect(result.normalized[0]!.amount).toBe(50);
  });
});
