import { describe, it, expect } from "vitest";

import {
  aggregateKanbanSales,
  EMPTY_KANBAN_SALES_AGGREGATE,
  type KanbanLeadStatusRow,
  type KanbanPaymentRow,
  type KanbanSaleRow,
} from "./aggregate";

const LAUNCH_ID = "launch-1";

function lead(overrides: Partial<KanbanLeadStatusRow>): KanbanLeadStatusRow {
  return {
    id: "lead-1",
    status: "cerrado",
    launch_id: LAUNCH_ID,
    ...overrides,
  };
}

function sale(overrides: Partial<KanbanSaleRow>): KanbanSaleRow {
  return {
    id: "sale-1",
    lead_id: "lead-1",
    total_amount: 1000,
    ...overrides,
  };
}

function payment(overrides: Partial<KanbanPaymentRow>): KanbanPaymentRow {
  return {
    sale_id: "sale-1",
    amount: 0,
    ...overrides,
  };
}

describe("aggregateKanbanSales", () => {
  it("array vacío de sales devuelve EMPTY_KANBAN_SALES_AGGREGATE", () => {
    expect(aggregateKanbanSales([], [], [], LAUNCH_ID)).toBe(
      EMPTY_KANBAN_SALES_AGGREGATE,
    );
  });

  it("lead en cerrado del launch suma a pledged y count", () => {
    const sales = [sale({ id: "s1", lead_id: "l1", total_amount: 1500 })];
    const leads = [lead({ id: "l1" })];
    const agg = aggregateKanbanSales(sales, [], leads, LAUNCH_ID);
    expect(agg.hasData).toBe(true);
    expect(agg.salesCount).toBe(1);
    expect(agg.pledgedRevenue).toBe(1500);
    expect(agg.collectedRevenue).toBe(0);
    expect(agg.paymentsCount).toBe(0);
  });

  it("lead NO en cerrado se ignora (decisión 2.a — solo columna cerrado)", () => {
    const sales = [
      sale({ id: "s-tibio", lead_id: "l-tibio", total_amount: 9999 }),
      sale({ id: "s-cerrado", lead_id: "l-cerrado", total_amount: 100 }),
    ];
    const leads = [
      lead({ id: "l-tibio", status: "tibio" }),
      lead({ id: "l-cerrado", status: "cerrado" }),
    ];
    const agg = aggregateKanbanSales(sales, [], leads, LAUNCH_ID);
    expect(agg.salesCount).toBe(1);
    expect(agg.pledgedRevenue).toBe(100);
  });

  it("lead de OTRO launch se ignora", () => {
    const sales = [
      sale({ id: "s-otro", lead_id: "l-otro", total_amount: 5000 }),
      sale({ id: "s-launch", lead_id: "l-launch", total_amount: 100 }),
    ];
    const leads = [
      lead({ id: "l-otro", launch_id: "otro-launch" }),
      lead({ id: "l-launch", launch_id: LAUNCH_ID }),
    ];
    const agg = aggregateKanbanSales(sales, [], leads, LAUNCH_ID);
    expect(agg.salesCount).toBe(1);
    expect(agg.pledgedRevenue).toBe(100);
  });

  it("lead con launch_id=null se ignora", () => {
    const sales = [sale({ lead_id: "l-orphan" })];
    const leads = [lead({ id: "l-orphan", launch_id: null })];
    const agg = aggregateKanbanSales(sales, [], leads, LAUNCH_ID);
    expect(agg.salesCount).toBe(0);
    expect(agg.hasData).toBe(false);
  });

  it("payments suman a collected solo si la sale fue contada", () => {
    const sales = [
      sale({ id: "s-ok", lead_id: "l-ok", total_amount: 1000 }),
      sale({ id: "s-tibio", lead_id: "l-tibio", total_amount: 9999 }),
    ];
    const leads = [
      lead({ id: "l-ok", status: "cerrado" }),
      lead({ id: "l-tibio", status: "tibio" }),
    ];
    const payments = [
      payment({ sale_id: "s-ok", amount: 400 }),
      payment({ sale_id: "s-ok", amount: 200 }),
      payment({ sale_id: "s-tibio", amount: 9999 }),
    ];
    const agg = aggregateKanbanSales(sales, payments, leads, LAUNCH_ID);
    expect(agg.salesCount).toBe(1);
    expect(agg.collectedRevenue).toBe(600);
    expect(agg.paymentsCount).toBe(2);
  });

  it("monetary y amount en string (numeric postgrest) se parsean OK", () => {
    const sales = [sale({ id: "s1", lead_id: "l1", total_amount: "1500.50" as unknown as number })];
    const leads = [lead({ id: "l1" })];
    const payments = [payment({ sale_id: "s1", amount: "499.50" as unknown as number })];
    const agg = aggregateKanbanSales(sales, payments, leads, LAUNCH_ID);
    expect(agg.pledgedRevenue).toBeCloseTo(1500.5, 2);
    expect(agg.collectedRevenue).toBeCloseTo(499.5, 2);
  });

  it("sin payments para una sale válida → collected=0 pero hasData=true", () => {
    const sales = [sale({ lead_id: "l1" })];
    const leads = [lead({ id: "l1" })];
    const agg = aggregateKanbanSales(sales, [], leads, LAUNCH_ID);
    expect(agg.hasData).toBe(true);
    expect(agg.collectedRevenue).toBe(0);
  });

  it("sale cuyo lead no existe en el array de leads se ignora", () => {
    const sales = [sale({ lead_id: "lead-fantasma" })];
    const agg = aggregateKanbanSales(sales, [], [], LAUNCH_ID);
    expect(agg.salesCount).toBe(0);
  });
});
