import { describe, it, expect } from "vitest";

import { calculateLaunchKPIs, type LaunchKPIInput } from "./kpis";
import type { CommunityAggregate } from "./launch-community/aggregate";
import type { DailyAggregate } from "./launch-daily/aggregate";
import type { KanbanSalesAggregate } from "./launch-sales/aggregate";

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
  revenue_estimated_manual: 50000,
  revenue_collected_manual: 30000,
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

describe("calculateLaunchKPIs — modelo aditivo kanban + manual (Phase 9)", () => {
  it("sin kanbanSalesAggregate → revenue/ventas vienen solo del manual", () => {
    const k = calculateLaunchKPIs(BASELINE);
    expect(k.ventas).toBe(100);
    expect(k.revenueEstimated).toBe(50000);
    expect(k.revenueCollected).toBe(30000);
    // Alias de compat.
    expect(k.revenue).toBe(50000);
  });

  it("kanbanSalesAggregate hasData=false (vacío) → solo manual cuenta", () => {
    const kanban: KanbanSalesAggregate = {
      hasData: false,
      pledgedRevenue: 0,
      collectedRevenue: 0,
      salesCount: 0,
      paymentsCount: 0,
    };
    const k = calculateLaunchKPIs(BASELINE, { kanbanSalesAggregate: kanban });
    expect(k.ventas).toBe(100);
    expect(k.revenueEstimated).toBe(50000);
    expect(k.revenueCollected).toBe(30000);
  });

  it("kanban con datos + manual → se SUMAN (decisión 3.b)", () => {
    const kanban: KanbanSalesAggregate = {
      hasData: true,
      pledgedRevenue: 20000,
      collectedRevenue: 15000,
      salesCount: 7,
      paymentsCount: 12,
    };
    const k = calculateLaunchKPIs(BASELINE, { kanbanSalesAggregate: kanban });
    expect(k.ventas).toBe(107); // 7 + 100
    expect(k.revenueEstimated).toBe(70000); // 20000 + 50000
    expect(k.revenueCollected).toBe(45000); // 15000 + 30000
  });

  it("solo kanban (manuales en 0) → revenue == kanban", () => {
    const empty: LaunchKPIInput = {
      ...BASELINE,
      ventas_total: 0,
      revenue_estimated_manual: 0,
      revenue_collected_manual: 0,
    };
    const kanban: KanbanSalesAggregate = {
      hasData: true,
      pledgedRevenue: 8000,
      collectedRevenue: 3500,
      salesCount: 4,
      paymentsCount: 6,
    };
    const k = calculateLaunchKPIs(empty, { kanbanSalesAggregate: kanban });
    expect(k.ventas).toBe(4);
    expect(k.revenueEstimated).toBe(8000);
    expect(k.revenueCollected).toBe(3500);
  });

  it("roasEstimated vs roasReal con inversión > 0", () => {
    const input: LaunchKPIInput = {
      ...BASELINE,
      meta_investment: 10000,
      revenue_estimated_manual: 50000,
      revenue_collected_manual: 25000,
    };
    const k = calculateLaunchKPIs(input);
    expect(k.totalInvestment).toBe(10000);
    expect(k.roasEstimated).toBe(5); // 50000 / 10000
    expect(k.roasReal).toBe(2.5); // 25000 / 10000
    // Alias.
    expect(k.roas).toBe(5);
  });

  it("inversión 0 → ambos ROAS en 0 (safeDiv)", () => {
    const k = calculateLaunchKPIs(BASELINE);
    expect(k.totalInvestment).toBe(0);
    expect(k.roasEstimated).toBe(0);
    expect(k.roasReal).toBe(0);
  });

  it("profitEstimated y profitReal", () => {
    const input: LaunchKPIInput = {
      ...BASELINE,
      meta_investment: 10000,
      revenue_estimated_manual: 50000,
      revenue_collected_manual: 25000,
    };
    const k = calculateLaunchKPIs(input);
    expect(k.profitEstimated).toBe(40000); // 50000 - 10000
    expect(k.profitReal).toBe(15000); // 25000 - 10000
    expect(k.profit).toBe(40000); // alias
  });

  it("ingresos_whatsapp queda manual aunque haya kanban (decisión 1.c original)", () => {
    const kanban: KanbanSalesAggregate = {
      hasData: true,
      pledgedRevenue: 20000,
      collectedRevenue: 10000,
      salesCount: 5,
      paymentsCount: 8,
    };
    const k = calculateLaunchKPIs(
      { ...BASELINE, ingresos_whatsapp: 3000 },
      { kanbanSalesAggregate: kanban },
    );
    expect(k.whatsappRevenue).toBe(3000);
    // Share se calcula sobre el revenueEstimated nuevo (70000).
    expect(k.whatsappRevenueShare).toBeCloseTo((3000 / 70000) * 100, 5);
  });

  it("kanban convive con adsAggregate sin interferencia", () => {
    const kanban: KanbanSalesAggregate = {
      hasData: true,
      pledgedRevenue: 10000,
      collectedRevenue: 5000,
      salesCount: 5,
      paymentsCount: 8,
    };
    const ads: DailyAggregate = {
      ...EMPTY_ADS,
      metaSpend: 1000,
      metaLeads: 50,
      daysCovered: 1,
    };
    const k = calculateLaunchKPIs(
      {
        ...BASELINE,
        ventas_total: 0,
        revenue_estimated_manual: 0,
        revenue_collected_manual: 0,
      },
      { kanbanSalesAggregate: kanban, adsAggregate: ads },
    );
    expect(k.metaInv).toBe(1000);
    expect(k.metaLeads).toBe(50);
    expect(k.ventas).toBe(5);
    expect(k.revenueEstimated).toBe(10000);
    expect(k.revenueCollected).toBe(5000);
    expect(k.profitEstimated).toBe(9000);
    expect(k.profitReal).toBe(4000);
  });
});

describe("calculateLaunchKPIs — community (SendFlow)", () => {
  it("sin communityAggregate → counts en 0, rates en null", () => {
    const k = calculateLaunchKPIs(BASELINE);
    expect(k.enteredCommunity).toBe(0);
    expect(k.leftCommunity).toBe(0);
    expect(k.communityClicks).toBe(0);
    expect(k.retentionRate).toBeNull();
    expect(k.enteredCommunityRate).toBeNull();
  });

  it("hasData=true: retentionRate = (entered - removed) / entered", () => {
    const community: CommunityAggregate = {
      hasData: true,
      entered: 100,
      removed: 20,
      clicks: 540,
    };
    const ads: DailyAggregate = {
      ...EMPTY_ADS,
      metaLeads: 400,
      daysCovered: 1,
    };
    const k = calculateLaunchKPIs(BASELINE, {
      adsAggregate: ads,
      communityAggregate: community,
    });
    expect(k.enteredCommunity).toBe(100);
    expect(k.leftCommunity).toBe(20);
    expect(k.communityClicks).toBe(540);
    expect(k.retentionRate).toBe(80);
    expect(k.enteredCommunityRate).toBe(25);
  });

  it("entered=0 → retentionRate null (no hay base)", () => {
    const community: CommunityAggregate = {
      hasData: false,
      entered: 0,
      removed: 0,
      clicks: 50,
    };
    const k = calculateLaunchKPIs(BASELINE, {
      communityAggregate: community,
    });
    expect(k.retentionRate).toBeNull();
  });

  it("totalLeads=0 → enteredCommunityRate null (sin denominador)", () => {
    const community: CommunityAggregate = {
      hasData: true,
      entered: 100,
      removed: 20,
      clicks: 540,
    };
    const k = calculateLaunchKPIs(BASELINE, {
      communityAggregate: community,
    });
    expect(k.enteredCommunityRate).toBeNull();
    expect(k.retentionRate).toBe(80);
  });

  it("removed > entered → retentionRate negativa (no clamp, lo que es)", () => {
    const community: CommunityAggregate = {
      hasData: true,
      entered: 10,
      removed: 25,
      clicks: 50,
    };
    const k = calculateLaunchKPIs(BASELINE, {
      communityAggregate: community,
    });
    expect(k.retentionRate).toBe(-150);
  });

  it("community convive con ads + kanban sin interferencia", () => {
    const ads: DailyAggregate = {
      ...EMPTY_ADS,
      metaSpend: 1000,
      metaLeads: 200,
      daysCovered: 1,
    };
    const kanban: KanbanSalesAggregate = {
      hasData: true,
      pledgedRevenue: 5000,
      collectedRevenue: 3000,
      salesCount: 10,
      paymentsCount: 15,
    };
    const community: CommunityAggregate = {
      hasData: true,
      entered: 50,
      removed: 5,
      clicks: 300,
    };
    const k = calculateLaunchKPIs(
      {
        ...BASELINE,
        ventas_total: 0,
        revenue_estimated_manual: 0,
        revenue_collected_manual: 0,
      },
      {
        adsAggregate: ads,
        kanbanSalesAggregate: kanban,
        communityAggregate: community,
      },
    );
    expect(k.metaInv).toBe(1000);
    expect(k.metaLeads).toBe(200);
    expect(k.ventas).toBe(10);
    expect(k.revenueEstimated).toBe(5000);
    expect(k.revenueCollected).toBe(3000);
    expect(k.retentionRate).toBe(90);
    expect(k.enteredCommunityRate).toBe(25);
  });
});
