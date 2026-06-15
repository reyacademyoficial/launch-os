import { describe, it, expect } from "vitest";

import {
  aggregateOpportunities,
  EMPTY_SALES_AGGREGATE,
  type LaunchOpportunityRow,
  type LaunchWindow,
} from "./aggregate";

const WINDOW: LaunchWindow = {
  date_start: "2026-06-01",
  date_end: "2026-06-30",
};

function row(overrides: Partial<LaunchOpportunityRow> = {}): LaunchOpportunityRow {
  return {
    status: "open",
    monetary_value: null,
    won_at: null,
    ...overrides,
  };
}

describe("aggregateOpportunities", () => {
  it("array vacío devuelve EMPTY_SALES_AGGREGATE con hasData=false", () => {
    expect(aggregateOpportunities([], WINDOW)).toBe(EMPTY_SALES_AGGREGATE);
    expect(aggregateOpportunities([], WINDOW).hasData).toBe(false);
  });

  it("solo opps abiertas/lost/abandoned → hasData=true, wonCount=0", () => {
    const rows = [
      row({ status: "open", monetary_value: 1000 }),
      row({ status: "lost", monetary_value: 500, won_at: "2026-06-15T12:00:00Z" }),
      row({ status: "abandoned", monetary_value: 200 }),
    ];
    const agg = aggregateOpportunities(rows, WINDOW);
    expect(agg.hasData).toBe(true);
    expect(agg.wonCount).toBe(0);
    expect(agg.wonRevenue).toBe(0);
  });

  it("won con won_at en ventana suma a wonCount y wonRevenue", () => {
    const rows = [
      row({ status: "won", monetary_value: 1500, won_at: "2026-06-10T15:00:00Z" }),
      row({ status: "won", monetary_value: 2000, won_at: "2026-06-25T09:00:00Z" }),
    ];
    const agg = aggregateOpportunities(rows, WINDOW);
    expect(agg.wonCount).toBe(2);
    expect(agg.wonRevenue).toBe(3500);
  });

  it("won con won_at fuera de la ventana NO cuenta (decisión 2.a)", () => {
    const rows = [
      row({ status: "won", monetary_value: 999, won_at: "2026-05-31T23:59:00Z" }),
      row({ status: "won", monetary_value: 999, won_at: "2026-07-01T00:01:00Z" }),
      row({ status: "won", monetary_value: 100, won_at: "2026-06-15T12:00:00Z" }),
    ];
    const agg = aggregateOpportunities(rows, WINDOW);
    expect(agg.wonCount).toBe(1);
    expect(agg.wonRevenue).toBe(100);
  });

  it("won sin won_at (null) NO cuenta — falta el timestamp autoritativo", () => {
    const rows = [
      row({ status: "won", monetary_value: 500, won_at: null }),
      row({ status: "won", monetary_value: 100, won_at: "2026-06-15T12:00:00Z" }),
    ];
    const agg = aggregateOpportunities(rows, WINDOW);
    expect(agg.wonCount).toBe(1);
    expect(agg.wonRevenue).toBe(100);
  });

  it("monetary_value null en won en-ventana cuenta para wonCount pero no suma a wonRevenue", () => {
    const rows = [
      row({ status: "won", monetary_value: null, won_at: "2026-06-15T12:00:00Z" }),
      row({ status: "won", monetary_value: 500, won_at: "2026-06-20T12:00:00Z" }),
    ];
    const agg = aggregateOpportunities(rows, WINDOW);
    expect(agg.wonCount).toBe(2);
    expect(agg.wonRevenue).toBe(500);
  });

  it("monetary_value en string (postgrest numeric) se parsea como decimal", () => {
    const rows = [
      row({ status: "won", monetary_value: "1499.99", won_at: "2026-06-10T12:00:00Z" }),
      row({ status: "won", monetary_value: "0.01", won_at: "2026-06-11T12:00:00Z" }),
    ];
    const agg = aggregateOpportunities(rows, WINDOW);
    expect(agg.wonCount).toBe(2);
    expect(agg.wonRevenue).toBeCloseTo(1500, 2);
  });

  it("won_at inválido (NaN parse) no cuenta", () => {
    const rows = [
      row({ status: "won", monetary_value: 100, won_at: "not-a-date" }),
      row({ status: "won", monetary_value: 200, won_at: "2026-06-15T12:00:00Z" }),
    ];
    const agg = aggregateOpportunities(rows, WINDOW);
    expect(agg.wonCount).toBe(1);
    expect(agg.wonRevenue).toBe(200);
  });

  it("opp con cualquier status pero hasData=true (sigue siendo signal de sync exitoso)", () => {
    // Una location con GHL configurado pero sin won todavía: tabla con rows
    // de status='open'. El KPI debe mostrar 0 (no fallback al manual).
    const rows = [
      row({ status: "open", monetary_value: 1500 }),
      row({ status: "open", monetary_value: 2000 }),
    ];
    const agg = aggregateOpportunities(rows, WINDOW);
    expect(agg.hasData).toBe(true);
    expect(agg.wonCount).toBe(0);
    expect(agg.wonRevenue).toBe(0);
  });

  it("ventana inclusiva: won_at exactamente en date_start o date_end cuenta", () => {
    const rows = [
      row({ status: "won", monetary_value: 100, won_at: "2026-06-01T00:00:00.000Z" }),
      row({ status: "won", monetary_value: 200, won_at: "2026-06-30T23:59:59.999Z" }),
    ];
    const agg = aggregateOpportunities(rows, WINDOW);
    expect(agg.wonCount).toBe(2);
    expect(agg.wonRevenue).toBe(300);
  });
});
