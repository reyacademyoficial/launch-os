import { describe, expect, it } from "vitest";

import {
  aggregateCommunityMetrics,
  EMPTY_COMMUNITY_AGGREGATE,
} from "./aggregate";

describe("aggregateCommunityMetrics", () => {
  it("0 filas → EMPTY_COMMUNITY_AGGREGATE", () => {
    expect(aggregateCommunityMetrics([])).toEqual(EMPTY_COMMUNITY_AGGREGATE);
  });

  it("1 fila con entered>0 → hasData=true + counts", () => {
    const agg = aggregateCommunityMetrics([
      { entered: 100, removed: 20, clicks: 540, synced_at: "2026-07-15T10:00:00Z" },
    ]);
    expect(agg).toEqual({
      hasData: true,
      entered: 100,
      removed: 20,
      clicks: 540,
    });
  });

  it("1 fila con entered=0 → hasData=false (sin actividad real)", () => {
    const agg = aggregateCommunityMetrics([
      { entered: 0, removed: 0, clicks: 50, synced_at: "2026-07-15T10:00:00Z" },
    ]);
    expect(agg.hasData).toBe(false);
    expect(agg.clicks).toBe(50);
  });

  it("múltiples filas → toma la de synced_at más reciente", () => {
    const agg = aggregateCommunityMetrics([
      { entered: 50, removed: 10, clicks: 100, synced_at: "2026-07-10T10:00:00Z" },
      { entered: 80, removed: 15, clicks: 200, synced_at: "2026-07-15T10:00:00Z" },
      { entered: 30, removed: 5, clicks: 75, synced_at: "2026-07-12T10:00:00Z" },
    ]);
    expect(agg.entered).toBe(80);
    expect(agg.removed).toBe(15);
    expect(agg.clicks).toBe(200);
  });

  it("acepta strings numéricos (postgrest puede devolver numeric como string)", () => {
    const agg = aggregateCommunityMetrics([
      { entered: "100", removed: "20", clicks: "540", synced_at: "2026-07-15T10:00:00Z" },
    ]);
    expect(agg.entered).toBe(100);
    expect(agg.removed).toBe(20);
    expect(agg.clicks).toBe(540);
  });

  it("synced_at null → no rompe, lo trata como fecha inválida", () => {
    const agg = aggregateCommunityMetrics([
      { entered: 10, removed: 1, clicks: 50, synced_at: null },
    ]);
    expect(agg.entered).toBe(10);
  });
});
