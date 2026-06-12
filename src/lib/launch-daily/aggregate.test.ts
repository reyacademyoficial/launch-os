import { describe, it, expect } from "vitest";

import { aggregateMergedDaily, EMPTY_DAILY_AGGREGATE } from "./aggregate";
import { mergeDailyData, type AdsDailyRow } from "./merge";
import type { LaunchDailyRow } from "./types";

function manualRow(
  date: string,
  overrides: Partial<LaunchDailyRow> = {},
): LaunchDailyRow {
  return {
    id: "manual-" + date,
    launch_id: "launch-1",
    date,
    meta_ads: 0,
    google_ads: 0,
    tiktok_ads: 0,
    organico: 0,
    whatsapp: 0,
    referidos: 0,
    otro: 0,
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
    ...overrides,
  };
}

function adsRow(
  overrides: Partial<AdsDailyRow> & Pick<AdsDailyRow, "date" | "provider">,
): AdsDailyRow {
  return {
    spend: 0,
    impressions: 0,
    clicks: 0,
    leads: 0,
    ...overrides,
  };
}

describe("aggregateMergedDaily — totales por canal", () => {
  it("array vacío devuelve EMPTY_DAILY_AGGREGATE", () => {
    expect(aggregateMergedDaily([])).toBe(EMPTY_DAILY_AGGREGATE);
    expect(aggregateMergedDaily([]).daysCovered).toBe(0);
  });

  it("solo manual → suma leads de canales pagos del manual; spend/clicks/impressions = 0", () => {
    const manual = [
      manualRow("2026-07-10", { meta_ads: 30, google_ads: 20, tiktok_ads: 10 }),
      manualRow("2026-07-11", { meta_ads: 15, google_ads: 5 }),
    ];
    const merged = mergeDailyData(manual, []);
    const agg = aggregateMergedDaily(merged);

    expect(agg.metaLeads).toBe(45);
    expect(agg.googleLeads).toBe(25);
    expect(agg.tiktokLeads).toBe(10);
    expect(agg.metaSpend).toBe(0);
    expect(agg.metaClicks).toBe(0);
    expect(agg.daysCovered).toBe(2);
  });

  it("solo API → suma leads/spend/clicks/impressions del API", () => {
    const ads: AdsDailyRow[] = [
      adsRow({
        date: "2026-07-10",
        provider: "meta",
        leads: 50,
        spend: 200,
        clicks: 500,
        impressions: 10_000,
      }),
      adsRow({
        date: "2026-07-11",
        provider: "meta",
        leads: 30,
        spend: 150,
        clicks: 300,
        impressions: 8_000,
      }),
    ];
    const merged = mergeDailyData([], ads);
    const agg = aggregateMergedDaily(merged);

    expect(agg.metaLeads).toBe(80);
    expect(agg.metaSpend).toBe(350);
    expect(agg.metaClicks).toBe(800);
    expect(agg.metaImpressions).toBe(18_000);
    expect(agg.daysCovered).toBe(2);
  });

  it("manual + API en el mismo día/canal → API gana (el merge ya lo resuelve)", () => {
    // Día 10: manual dice 50 leads de meta; API dice 60. Gana API.
    // Día 11: solo manual con 40 leads. Manual es el fallback.
    const manual = [
      manualRow("2026-07-10", { meta_ads: 50 }),
      manualRow("2026-07-11", { meta_ads: 40 }),
    ];
    const ads: AdsDailyRow[] = [
      adsRow({ date: "2026-07-10", provider: "meta", leads: 60, spend: 100 }),
    ];
    const merged = mergeDailyData(manual, ads);
    const agg = aggregateMergedDaily(merged);

    expect(agg.metaLeads).toBe(100); // 60 (API día 10) + 40 (manual día 11)
    expect(agg.metaSpend).toBe(100); // solo el día 10 tiene spend
    expect(agg.daysCovered).toBe(2);
  });

  it("providers mixtos → cada canal acumula su total", () => {
    const ads: AdsDailyRow[] = [
      adsRow({ date: "2026-07-10", provider: "meta", leads: 50, spend: 100 }),
      adsRow({
        date: "2026-07-10",
        provider: "google",
        leads: 30,
        spend: 80,
      }),
      adsRow({ date: "2026-07-10", provider: "tiktok", leads: 20, spend: 40 }),
    ];
    const merged = mergeDailyData([], ads);
    const agg = aggregateMergedDaily(merged);

    expect(agg.metaLeads).toBe(50);
    expect(agg.metaSpend).toBe(100);
    expect(agg.googleLeads).toBe(30);
    expect(agg.googleSpend).toBe(80);
    expect(agg.tiktokLeads).toBe(20);
    expect(agg.tiktokSpend).toBe(40);
    expect(agg.daysCovered).toBe(1);
  });
});
