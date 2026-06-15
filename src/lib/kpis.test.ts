import { describe, it, expect } from "vitest";

import { calculateLaunchKPIs, type LaunchKPIInput } from "./kpis";
import type { DailyAggregate } from "./launch-daily/aggregate";
import type { SalesAggregate } from "./launch-opportunities/aggregate";

const BASELINE: LaunchKPIInput = {
  meta_investment: 0,
  meta_leads: 0,
  google_investment: 0,
  google_leads: 0,
  tiktok_investment: 0,
  tiktok_leads: 0,
  contactos_api: 0,
  ingresos_whatsapp: 0,
  registrados: 0,
  asistentes: 0,
  hasta_pitch: 0,
  ventas_total: 100,
  revenue: 50000,
};

const EMPTY_ADS: DailyAggregate = {
  metaLeads: 0,
  metaSpend: 0,
  metaClicks: 0,
  metaImpressions: 0,
  googleLeads: 0,
  googleSpend: 0,
  googleClicks: 0,
  googleImpressions: 0,
  tiktokLeads: 0,
  tiktokSpend: 0,
  tiktokClicks: 0,
  tiktokImpressions: 0,
  daysCovered: 0,
};

describe("calculateLaunchKPIs — fallback salesAggregate vs manual", () => {
  it("sin salesAggregate → ventas/revenue desde launches.*", () => {
    const k = calculateLaunchKPIs(BASELINE);
    expect(k.ventas).toBe(100);
    expect(k.revenue).toBe(50000);
  });

  it("salesAggregate con hasData=false → fallback al manual", () => {
    const sales: SalesAggregate = {
      hasData: false,
      wonCount: 9999,
      wonRevenue: 999999,
    };
    const k = calculateLaunchKPIs(BASELINE, { salesAggregate: sales });
    // hasData=false: ignoramos los valores aunque vengan llenos
    expect(k.ventas).toBe(100);
    expect(k.revenue).toBe(50000);
  });

  it("salesAggregate con hasData=true → ventas/revenue del agregado, NO mezcla con manual", () => {
    const sales: SalesAggregate = {
      hasData: true,
      wonCount: 7,
      wonRevenue: 12500,
    };
    const k = calculateLaunchKPIs(BASELINE, { salesAggregate: sales });
    expect(k.ventas).toBe(7);
    expect(k.revenue).toBe(12500);
    // ROAS y CAC derivados deben usar el revenue/ventas del aggregate.
    // Sin inversión, ROAS = 0 (safeDiv).
    expect(k.roas).toBe(0);
    // Con inversión 0 y ventas 7, CAC = 0/7 = 0.
    expect(k.cac).toBe(0);
  });

  it("salesAggregate con hasData=true Y wonCount=0 → 0 ventas (no fallback)", () => {
    // Caso: GHL configurado y sincronizado pero sin won en ventana. El KPI
    // debe mostrar 0, no caer al manual.
    const sales: SalesAggregate = {
      hasData: true,
      wonCount: 0,
      wonRevenue: 0,
    };
    const k = calculateLaunchKPIs(BASELINE, { salesAggregate: sales });
    expect(k.ventas).toBe(0);
    expect(k.revenue).toBe(0);
  });

  it("ingresos_whatsapp queda manual aunque haya salesAggregate (decisión 1.c)", () => {
    const sales: SalesAggregate = {
      hasData: true,
      wonCount: 7,
      wonRevenue: 12500,
    };
    const k = calculateLaunchKPIs(
      { ...BASELINE, ingresos_whatsapp: 3000 },
      { salesAggregate: sales },
    );
    expect(k.whatsappRevenue).toBe(3000);
    // whatsappRevenueShare debe derivarse del revenue NUEVO (12500), no del
    // viejo manual de BASELINE — para que el porcentaje sea coherente.
    expect(k.whatsappRevenueShare).toBeCloseTo((3000 / 12500) * 100, 5);
  });

  it("salesAggregate convive con adsAggregate sin interferencia", () => {
    const sales: SalesAggregate = {
      hasData: true,
      wonCount: 5,
      wonRevenue: 10000,
    };
    const ads: DailyAggregate = {
      ...EMPTY_ADS,
      metaSpend: 1000,
      metaLeads: 50,
      daysCovered: 1,
    };
    const k = calculateLaunchKPIs(BASELINE, {
      salesAggregate: sales,
      adsAggregate: ads,
    });
    expect(k.metaInv).toBe(1000);
    expect(k.metaLeads).toBe(50);
    expect(k.ventas).toBe(5);
    expect(k.revenue).toBe(10000);
    // Profit = 10000 - 1000 = 9000
    expect(k.profit).toBe(9000);
  });
});
