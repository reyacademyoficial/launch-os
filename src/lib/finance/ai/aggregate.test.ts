import { describe, expect, it } from "vitest";

import {
  aggregateByCategory,
  aggregatePayrollByPerson,
  detectRecurringExpenses,
  normalizeDescriptionKey,
  topExpenses,
  unpaidExpenses,
} from "./aggregate";
import type { ExpenseDetail } from "./types";

function expense(over: Partial<ExpenseDetail> & { id: string }): ExpenseDetail {
  return {
    description: "Gasto",
    category: "software",
    netUsd: 100,
    currency: "USD",
    nativeGross: 100,
    expenseDate: "2026-01-15",
    paidAt: "2026-01-15",
    dueDate: null,
    supplierName: null,
    projectName: null,
    ...over,
  };
}

const MONTHS = ["2026-01", "2026-02", "2026-03", "2026-04"];

describe("normalizeDescriptionKey — agrupar el mismo gasto escrito distinto", () => {
  it("fusiona variantes con período, mayúsculas y espacios", () => {
    const a = normalizeDescriptionKey("Netflix 09/2026");
    expect(normalizeDescriptionKey("  netflix  ")).toBe(a);
    expect(normalizeDescriptionKey("NETFLIX")).toBe(a);
  });

  it("saca acentos para que 'Publicidad Metá' no sea otro grupo", () => {
    expect(normalizeDescriptionKey("Suscripción")).toBe(
      normalizeDescriptionKey("Suscripcion"),
    );
  });

  it("una descripción que es solo un número no colapsa a clave vacía", () => {
    // Sin el fallback, '123' y '456' caerían en el mismo grupo "" y el
    // detector los reportaría como un gasto recurrente inexistente.
    expect(normalizeDescriptionKey("123")).not.toBe(
      normalizeDescriptionKey("456"),
    );
  });
});

describe("aggregateByCategory", () => {
  const rows = [
    expense({ id: "1", category: "software", netUsd: 100, expenseDate: "2026-01-10" }),
    expense({ id: "2", category: "software", netUsd: 300, expenseDate: "2026-03-10" }),
    expense({ id: "3", category: "alquiler", netUsd: 600, expenseDate: "2026-03-01" }),
  ];
  const stats = aggregateByCategory(rows, {
    monthKeys: MONTHS,
    lastMonthKey: "2026-03",
    labelBySlug: new Map([["software", "Software"]]),
    bucketBySlug: new Map([["software", "operating"]]),
  });

  it("ordena por total descendente", () => {
    expect(stats.map((s) => s.slug)).toEqual(["alquiler", "software"]);
  });

  it("promedia sobre los meses de la VENTANA, no sobre los meses con gasto", () => {
    // Software: 400 en 2 meses distintos, pero la ventana son 4 meses.
    // 400/4 = 100 — un gasto esporádico no debe parecer mensual.
    const software = stats.find((s) => s.slug === "software")!;
    expect(software.avgPerMonthUsd).toBe(100);
    expect(software.monthsWithSpend).toBe(2);
  });

  it("share suma 1 sobre el total de gastos", () => {
    const total = stats.reduce((acc, s) => acc + s.share, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("aísla el último mes cerrado", () => {
    expect(stats.find((s) => s.slug === "software")!.lastMonthUsd).toBe(300);
  });

  it("gastos sin categoría caen en 'sin-categoria' en vez de perderse", () => {
    const out = aggregateByCategory([expense({ id: "x", category: null })], {
      monthKeys: MONTHS,
      lastMonthKey: "2026-03",
      labelBySlug: new Map(),
      bucketBySlug: new Map(),
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.slug).toBe("sin-categoria");
    expect(out[0]!.bucket).toBe("operating");
  });

  it("total 0 no produce NaN ni Infinity en el share", () => {
    const out = aggregateByCategory([expense({ id: "z", netUsd: 0 })], {
      monthKeys: MONTHS,
      lastMonthKey: "2026-03",
      labelBySlug: new Map(),
      bucketBySlug: new Map(),
    });
    expect(out[0]!.share).toBe(0);
  });
});

describe("detectRecurringExpenses", () => {
  it("cuenta MESES distintos, no filas: dos facturas del mismo mes no hacen recurrencia", () => {
    const rows = [
      expense({ id: "1", description: "Figma", expenseDate: "2026-01-05" }),
      expense({ id: "2", description: "Figma", expenseDate: "2026-01-20" }),
      expense({ id: "3", description: "Figma", expenseDate: "2026-02-05" }),
    ];
    expect(detectRecurringExpenses(rows, { minMonths: 3 })).toHaveLength(0);
  });

  it("detecta la suscripción mensual y calcula promedio por mes", () => {
    const rows = [
      expense({ id: "1", description: "Figma 01/2026", netUsd: 90, expenseDate: "2026-01-05" }),
      expense({ id: "2", description: "Figma 02/2026", netUsd: 90, expenseDate: "2026-02-05" }),
      expense({ id: "3", description: "Figma 03/2026", netUsd: 120, expenseDate: "2026-03-05" }),
    ];
    const [figma] = detectRecurringExpenses(rows, { minMonths: 3 });
    expect(figma!.months).toBe(3);
    expect(figma!.totalUsd).toBe(300);
    expect(figma!.avgUsd).toBe(100);
    expect(figma!.minUsd).toBe(90);
    expect(figma!.maxUsd).toBe(120);
  });

  it("la fila más reciente define la categoría mostrada (recategorizaciones)", () => {
    const rows = [
      expense({ id: "1", description: "Slack", category: "otros", expenseDate: "2026-01-05" }),
      expense({ id: "2", description: "Slack", category: "otros", expenseDate: "2026-02-05" }),
      expense({ id: "3", description: "Slack", category: "software", expenseDate: "2026-03-05" }),
    ];
    const [slack] = detectRecurringExpenses(rows, { minMonths: 3 });
    expect(slack!.category).toBe("software");
    expect(slack!.lastYmd).toBe("2026-03-05");
  });
});

describe("rankings", () => {
  it("topExpenses corta por monto sin mutar la entrada", () => {
    const rows = [
      expense({ id: "1", netUsd: 10 }),
      expense({ id: "2", netUsd: 900 }),
      expense({ id: "3", netUsd: 50 }),
    ];
    expect(topExpenses(rows, 2).map((e) => e.id)).toEqual(["2", "3"]);
    expect(rows.map((e) => e.id)).toEqual(["1", "2", "3"]);
  });

  it("unpaidExpenses filtra pagados y ordena por vencimiento más próximo", () => {
    const rows = [
      expense({ id: "pagado", paidAt: "2026-02-01" }),
      expense({ id: "tarde", paidAt: null, dueDate: "2026-05-01" }),
      expense({ id: "urgente", paidAt: null, dueDate: "2026-01-01" }),
    ];
    expect(unpaidExpenses(rows).map((e) => e.id)).toEqual(["urgente", "tarde"]);
  });

  it("un impago sin vencimiento se ordena por fecha de gasto", () => {
    const rows = [
      expense({ id: "sin-due", paidAt: null, dueDate: null, expenseDate: "2026-01-02" }),
      expense({ id: "con-due", paidAt: null, dueDate: "2026-03-01" }),
    ];
    expect(unpaidExpenses(rows).map((e) => e.id)).toEqual(["sin-due", "con-due"]);
  });
});

describe("aggregatePayrollByPerson", () => {
  it("consolida por persona y promedia por período", () => {
    const out = aggregatePayrollByPerson([
      { personName: "Ana", totalUsd: 1000 },
      { personName: "Ana", totalUsd: 1200 },
      { personName: "Beto", totalUsd: 3000 },
    ]);
    expect(out[0]).toEqual({
      personName: "Beto",
      totalUsd: 3000,
      periods: 1,
      avgPerPeriodUsd: 3000,
    });
    expect(out[1]!.avgPerPeriodUsd).toBe(1100);
  });
});
