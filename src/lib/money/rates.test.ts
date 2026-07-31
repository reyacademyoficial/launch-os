import { describe, expect, it } from "vitest";

import {
  buildFxRateMap,
  effectiveCurrency,
  getLaunchRate,
  monthKey,
  resolveMonthlyRateFromMap,
} from "./rates";

describe("monthKey", () => {
  it("extracts YYYY-MM from a YYYY-MM-DD string without timezone shift", () => {
    // En UTC-3 (Buenos Aires), new Date("2026-07-01") cae en junio local.
    // El parseo manual del path YYYY-MM-DD evita ese off-by-one.
    expect(monthKey("2026-07-01")).toBe("2026-07");
    expect(monthKey("2026-01-31")).toBe("2026-01");
  });

  it("handles ISO timestamps via UTC", () => {
    expect(monthKey("2026-07-15T10:00:00Z")).toBe("2026-07");
  });

  it("handles Date instances", () => {
    expect(monthKey(new Date(Date.UTC(2026, 6, 15)))).toBe("2026-07");
  });
});

describe("buildFxRateMap + resolveMonthlyRateFromMap", () => {
  it("builds a map keyed by YYYY-MM and resolves matching dates", () => {
    const map = buildFxRateMap([
      { month: "2026-07-01", ars_per_usd: 1200 },
      { month: "2026-08-01", ars_per_usd: 1300 },
    ]);
    expect(resolveMonthlyRateFromMap(map, "2026-07-20")).toBe(1200);
    expect(resolveMonthlyRateFromMap(map, "2026-08-01")).toBe(1300);
    expect(resolveMonthlyRateFromMap(map, "2026-09-01")).toBeNull();
  });

  it("ignores invalid rates defensively", () => {
    const map = buildFxRateMap([
      { month: "2026-07-01", ars_per_usd: 0 },
      { month: "2026-08-01", ars_per_usd: -100 },
    ]);
    expect(resolveMonthlyRateFromMap(map, "2026-07-15")).toBeNull();
    expect(resolveMonthlyRateFromMap(map, "2026-08-15")).toBeNull();
  });
});

describe("getLaunchRate", () => {
  it("returns the rate when set and positive", () => {
    expect(getLaunchRate({ ars_per_usd: 1200 })).toBe(1200);
  });
  it("returns null for null/undefined/zero/negative", () => {
    expect(getLaunchRate({ ars_per_usd: null })).toBeNull();
    expect(getLaunchRate({})).toBeNull();
    expect(getLaunchRate({ ars_per_usd: 0 })).toBeNull();
    expect(getLaunchRate({ ars_per_usd: -50 })).toBeNull();
  });
});

describe("effectiveCurrency", () => {
  it("uses the bank currency when the method has a bank", () => {
    expect(
      effectiveCurrency({ currency: "ARS" }, { currency: "USD" }),
    ).toBe("USD");
  });

  it("falls back to method currency when there is no bank", () => {
    expect(effectiveCurrency({ currency: "USD" }, null)).toBe("USD");
  });

  it("defaults to ARS when both are missing (defensive)", () => {
    expect(effectiveCurrency(null, null)).toBe("ARS");
    expect(effectiveCurrency({ currency: null }, { currency: null })).toBe(
      "ARS",
    );
  });
});
