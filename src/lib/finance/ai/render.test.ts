import { describe, expect, it } from "vitest";

import { renderFinanceSnapshot } from "./render";
import type { ExpenseDetail, FinanceSnapshot } from "./types";

function expense(id: string, netUsd: number): ExpenseDetail {
  return {
    id,
    description: `Gasto ${id}`,
    category: "software",
    netUsd,
    currency: "USD",
    nativeGross: netUsd,
    expenseDate: "2026-03-10",
    paidAt: null,
    dueDate: "2026-04-10",
    supplierName: null,
    projectName: null,
  };
}

const SNAPSHOT: FinanceSnapshot = {
  generatedAt: "2026-09-02T10:00:00.000Z",
  windowFromYmd: "2025-10-01",
  windowToYmd: "2026-09-02",
  windowMonths: 12,
  lastClosedMonthKey: "2026-08",
  // Tamaños realistas: 12 meses, 30 gastos grandes, 20 impagos. El ahorro
  // del modo compacto se mide contra un prompt del porte del real, no
  // contra un fixture de juguete.
  monthly: Array.from({ length: 12 }, (_, i) => ({
    key: `2026-${String(i + 1).padStart(2, "0")}`,
    label: "mes",
    revenueUsd: 10_000,
    directUsd: 2000,
    operatingUsd: 1500,
    taxesUsd: 500,
    payrollUsd: 3000,
    netProfitUsd: 3000,
  })),
  categories: Array.from({ length: 12 }, (_, i) => ({
    slug: `cat-${i}`,
    label: `Categoría ${i}`,
    bucket: "operating" as const,
    totalUsd: 1000 - i,
    count: 3,
    monthsWithSpend: 3,
    avgPerMonthUsd: 83,
    lastMonthUsd: 90,
    share: 0.08,
  })),
  recurring: Array.from({ length: 12 }, (_, i) => ({
    key: `rec-${i}`,
    description: `Suscripción ${i}`,
    category: "software",
    supplierName: null,
    months: 6,
    totalUsd: 600 - i,
    avgUsd: 100,
    minUsd: 90,
    maxUsd: 110,
    lastYmd: "2026-08-05",
    lastUsd: 100,
  })),
  topExpenses: Array.from({ length: 30 }, (_, i) =>
    expense(`top-${i}`, 5000 - i * 10),
  ),
  unpaidExpenses: Array.from({ length: 20 }, (_, i) =>
    expense(`imp-${i}`, 2000 - i * 10),
  ),
  payrollByPerson: Array.from({ length: 6 }, (_, i) => ({
    personName: `Persona ${i}`,
    totalUsd: 12_000,
    periods: 12,
    avgPerPeriodUsd: 1000,
  })),
  totals: {
    revenueUsd: 120_000,
    expensesNetUsd: 40_000,
    payrollUsd: 36_000,
    payoutsUsd: 4000,
    netProfitUsd: 40_000,
    marginPct: 0.333,
  },
  position: {
    cashUsd: 50_000,
    activeBanks: 3,
    burnMonthlyUsd: 8000,
    runwayMonths: 6.25,
    runwayReason: "ok",
    receivableUsd: 9000,
    payableUsd: 7000,
    netWorthUsd: 52_000,
  },
  fx: { latestRate: 1450, latestRateMonth: "2026-08" },
  warnings: ["Faltan 3 gastos sin categoría."],
};

describe("renderFinanceSnapshot — modo full", () => {
  const text = renderFinanceSnapshot(SNAPSHOT);

  it("lista TODAS las categorías y recurrentes", () => {
    expect(text).toContain("Categoría 11");
    expect(text).toContain("Suscripción 11");
    expect(text).not.toContain("no listadas");
  });

  it("incluye los bloques de detalle fino", () => {
    expect(text).toContain("## Gastos individuales más grandes");
    expect(text).toContain("## Nómina por persona");
    expect(text).toContain("## Gastos devengados sin pagar");
  });

  it("emite montos SIN separadores de miles (un LLM lee '1.234' como 1,234)", () => {
    expect(text).toContain("120000");
    expect(text).not.toContain("120.000");
  });
});

describe("renderFinanceSnapshot — modo compact", () => {
  const compact = renderFinanceSnapshot(SNAPSHOT, { detail: "compact" });
  const full = renderFinanceSnapshot(SNAPSHOT, { detail: "full" });

  it("achica el prompt a menos de la mitad", () => {
    expect(compact.length).toBeLessThan(full.length * 0.5);
  });

  it("recorta las listas largas y lo declara", () => {
    expect(compact).toContain("Categoría 0");
    expect(compact).not.toContain("Categoría 11");
    expect(compact).toContain("+4 categorías menores no listadas");
    expect(compact).toContain("+4 recurrentes menores no listados");
  });

  it("saca el detalle fino pero deja el resumen y la instrucción de no inventar", () => {
    expect(compact).not.toContain("## Nómina por persona");
    expect(compact).toContain("## Detalle fino (no incluido en este turno)");
    expect(compact).toContain("NO la inventes");
  });

  it("conserva SIEMPRE los agregados que sostienen una conclusión", () => {
    for (const block of [
      "## Totales de la ventana",
      "## Posición actual",
      "## P&L mensual",
    ]) {
      expect(compact).toContain(block);
    }
  });

  it("conserva SIEMPRE los avisos de calidad de dato", () => {
    expect(compact).toContain("## Avisos de calidad de dato");
    expect(compact).toContain("Faltan 3 gastos sin categoría.");
  });
});
