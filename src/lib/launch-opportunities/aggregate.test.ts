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

  it("solo opps abiertas/lost/abandoned → hasData=false (walk-back 2026-06-16)", () => {
    // Walk-back: antes `hasData=true` con cualquier fila, lo que tapaba el
    // manual cuando GHL traía opps abiertas sin ventas cerradas. Ahora
    // hasData=false cuando wonCount=0, y el KPI cae al form manual.
    const rows = [
      row({ status: "open", monetary_value: 1000 }),
      row({ status: "lost", monetary_value: 500, won_at: "2026-06-15T12:00:00Z" }),
      row({ status: "abandoned", monetary_value: 200 }),
    ];
    const agg = aggregateOpportunities(rows, WINDOW);
    expect(agg.hasData).toBe(false);
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

  it("GHL trajo opps abiertas pero ninguna won → hasData=false → KPI usa manual", () => {
    // Walk-back 2026-06-16: antes este caso devolvía hasData=true (pisando
    // launches.revenue cargado a mano con 0). Ahora hasData se ata a
    // wonCount > 0 — si no hay nada ganado en ventana, el form manual gana.
    const rows = [
      row({ status: "open", monetary_value: 1500 }),
      row({ status: "open", monetary_value: 2000 }),
    ];
    const agg = aggregateOpportunities(rows, WINDOW);
    expect(agg.hasData).toBe(false);
    expect(agg.wonCount).toBe(0);
    expect(agg.wonRevenue).toBe(0);
  });

  it("mix de opps abiertas + 1 won en ventana → hasData=true", () => {
    // Confirma la regla nueva: basta UNA won en ventana para que el agregado
    // se considere autoritativo. wonCount=1, wonRevenue=500.
    const rows = [
      row({ status: "open", monetary_value: 9999 }),
      row({ status: "won", monetary_value: 500, won_at: "2026-06-15T12:00:00Z" }),
    ];
    const agg = aggregateOpportunities(rows, WINDOW);
    expect(agg.hasData).toBe(true);
    expect(agg.wonCount).toBe(1);
    expect(agg.wonRevenue).toBe(500);
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
