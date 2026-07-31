import { describe, expect, it } from "vitest";

import { pickRate, sumInUsd, toUsd } from "./convert";
import type { FxContext, NativeAmount } from "./types";

describe("pickRate", () => {
  it("prefers launch rate over monthly when both are present", () => {
    expect(pickRate({ launchArsPerUsd: 1200, monthlyArsPerUsd: 1000 })).toBe(
      1200,
    );
  });

  it("falls back to monthly when launch is missing", () => {
    expect(pickRate({ launchArsPerUsd: null, monthlyArsPerUsd: 1000 })).toBe(
      1000,
    );
  });

  it("returns null when neither is set", () => {
    expect(pickRate({})).toBeNull();
  });

  it("ignores non-positive rates (defensive against dirty data)", () => {
    expect(pickRate({ launchArsPerUsd: 0 })).toBeNull();
    expect(pickRate({ launchArsPerUsd: -100 })).toBeNull();
    expect(pickRate({ launchArsPerUsd: NaN })).toBeNull();
  });
});

describe("toUsd", () => {
  it("returns USD amounts unchanged even when a rate is present", () => {
    const native: NativeAmount = { amount: 42, currency: "USD" };
    expect(toUsd(native, { launchArsPerUsd: 1200 })).toBe(42);
  });

  it("divides ARS by launch rate", () => {
    const native: NativeAmount = { amount: 120_000, currency: "ARS" };
    expect(toUsd(native, { launchArsPerUsd: 1200 })).toBe(100);
  });

  it("divides ARS by monthly rate when no launch rate", () => {
    const native: NativeAmount = { amount: 100_000, currency: "ARS" };
    expect(toUsd(native, { monthlyArsPerUsd: 1000 })).toBe(100);
  });

  it("returns null for ARS amounts without any rate", () => {
    const native: NativeAmount = { amount: 1000, currency: "ARS" };
    expect(toUsd(native, {})).toBeNull();
  });
});

describe("sumInUsd", () => {
  interface Payment {
    amount: number;
    currency: "ARS" | "USD";
    launchRate: number | null;
  }
  const extract = (p: Payment) => ({
    native: { amount: p.amount, currency: p.currency },
    ctx: { launchArsPerUsd: p.launchRate } as FxContext,
  });

  it("sums mixed ARS/USD payments correctly", () => {
    const payments: Payment[] = [
      { amount: 100, currency: "USD", launchRate: null },
      { amount: 120_000, currency: "ARS", launchRate: 1200 }, // → 100 USD
      { amount: 50, currency: "USD", launchRate: null },
    ];
    const { total, missingCount } = sumInUsd(payments, extract);
    expect(total).toBe(250);
    expect(missingCount).toBe(0);
  });

  it("skips items with no rate and reports missingArs", () => {
    const payments: Payment[] = [
      { amount: 100, currency: "USD", launchRate: null },
      { amount: 500_000, currency: "ARS", launchRate: null }, // missing
      { amount: 240_000, currency: "ARS", launchRate: 1200 }, // → 200 USD
    ];
    const { total, missingCount, missingArs } = sumInUsd(payments, extract);
    expect(total).toBe(300);
    expect(missingCount).toBe(1);
    expect(missingArs).toBe(500_000);
  });
});
