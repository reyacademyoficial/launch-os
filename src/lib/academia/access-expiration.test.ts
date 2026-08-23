import { describe, expect, it } from "vitest";

import {
  computeAccessExpiresAt,
  paymentPlanFromInstallmentCount,
  toYmd,
} from "./access-expiration";

const REF_DATE = new Date("2026-01-15T12:00:00Z");

describe("computeAccessExpiresAt — override por curso", () => {
  it("courseFixedAccessDays > 0 gana sobre pago único", () => {
    const out = computeAccessExpiresAt({
      purchasedAt: REF_DATE,
      paymentPlan: "single",
      courseFixedAccessDays: 365,
    });
    expect(out).not.toBeNull();
    expect(toYmd(out!)).toBe("2027-01-15");
  });

  it("courseFixedAccessDays gana sobre cuotas con distinta duración", () => {
    const out = computeAccessExpiresAt({
      purchasedAt: REF_DATE,
      paymentPlan: "installments",
      courseFixedAccessDays: 180,
    });
    expect(out).not.toBeNull();
    expect(toYmd(out!)).toBe("2026-07-14");
  });

  it("courseFixedAccessDays gana incluso sin sale", () => {
    const out = computeAccessExpiresAt({
      purchasedAt: REF_DATE,
      paymentPlan: null,
      courseFixedAccessDays: 30,
    });
    expect(out).not.toBeNull();
    expect(toYmd(out!)).toBe("2026-02-14");
  });

  it("courseFixedAccessDays trunca decimales", () => {
    const out = computeAccessExpiresAt({
      purchasedAt: REF_DATE,
      paymentPlan: "single",
      courseFixedAccessDays: 30.9,
    });
    expect(out).not.toBeNull();
    expect(toYmd(out!)).toBe("2026-02-14");
  });

  it("courseFixedAccessDays = 0 se ignora (no es override)", () => {
    const out = computeAccessExpiresAt({
      purchasedAt: REF_DATE,
      paymentPlan: "installments",
      courseFixedAccessDays: 0,
    });
    // cae a la regla por método de pago
    expect(out).not.toBeNull();
    expect(toYmd(out!)).toBe("2027-01-15");
  });

  it("courseFixedAccessDays negativo se ignora", () => {
    const out = computeAccessExpiresAt({
      purchasedAt: REF_DATE,
      paymentPlan: "single",
      courseFixedAccessDays: -10,
    });
    expect(out).toBeNull();
  });
});

describe("computeAccessExpiresAt — regla por método de pago", () => {
  it("pago único sin override → null (sin vencimiento)", () => {
    const out = computeAccessExpiresAt({
      purchasedAt: REF_DATE,
      paymentPlan: "single",
      courseFixedAccessDays: null,
    });
    expect(out).toBeNull();
  });

  it("cuotas sin override → 365 días desde purchasedAt", () => {
    const out = computeAccessExpiresAt({
      purchasedAt: REF_DATE,
      paymentPlan: "installments",
      courseFixedAccessDays: null,
    });
    expect(out).not.toBeNull();
    expect(toYmd(out!)).toBe("2027-01-15");
  });

  it("sin sale (paymentPlan=null) sin override → null", () => {
    const out = computeAccessExpiresAt({
      purchasedAt: REF_DATE,
      paymentPlan: null,
      courseFixedAccessDays: null,
    });
    expect(out).toBeNull();
  });
});

describe("paymentPlanFromInstallmentCount", () => {
  it("count=1 → single", () => {
    expect(paymentPlanFromInstallmentCount(1)).toBe("single");
  });

  it("count>1 → installments", () => {
    expect(paymentPlanFromInstallmentCount(2)).toBe("installments");
    expect(paymentPlanFromInstallmentCount(12)).toBe("installments");
    expect(paymentPlanFromInstallmentCount(999)).toBe("installments");
  });

  it("count<1, null, undefined, NaN → null", () => {
    expect(paymentPlanFromInstallmentCount(0)).toBeNull();
    expect(paymentPlanFromInstallmentCount(-1)).toBeNull();
    expect(paymentPlanFromInstallmentCount(null)).toBeNull();
    expect(paymentPlanFromInstallmentCount(undefined)).toBeNull();
    expect(paymentPlanFromInstallmentCount(Number.NaN)).toBeNull();
  });
});

describe("toYmd — timezone-safe UTC", () => {
  it("formatea fecha UTC como YYYY-MM-DD sin desfase", () => {
    expect(toYmd(new Date("2026-01-15T12:00:00Z"))).toBe("2026-01-15");
    expect(toYmd(new Date("2026-12-31T23:59:59Z"))).toBe("2026-12-31");
    expect(toYmd(new Date("2027-01-01T00:00:00Z"))).toBe("2027-01-01");
  });
});
