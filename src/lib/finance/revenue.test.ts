import { describe, expect, it } from "vitest";

import type { Ownership } from "./invoice-classification";
import { computeRevenue, type OwnershipResolver } from "./revenue";
import type {
  FinanceInvoiceRow,
  FinanceLaunchSettlementRow,
} from "./types";

function settlement(
  overrides: Partial<FinanceLaunchSettlementRow> = {},
): FinanceLaunchSettlementRow {
  return {
    kingrow_retained: 0,
    status: "liquidada",
    closed_at: "2026-07-01T00:00:00Z",
    created_at: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

function invoice(overrides: Partial<FinanceInvoiceRow> = {}): FinanceInvoiceRow {
  return {
    project_id: null,
    launch_id: null,
    amount_gross: 0,
    tax_amount: 0,
    status: "cobrada",
    paid_at: "2026-07-15",
    due_date: "2026-07-15",
    issue_date: "2026-07-01",
    ...overrides,
  };
}

/** Resolver de ownership a partir de un mapa simple. */
function resolver(map: Record<string, Ownership>): OwnershipResolver {
  return (pid) => (pid == null ? null : map[pid] ?? null);
}

const NO_OWNERSHIP: OwnershipResolver = () => null;

describe("computeRevenue — settlements", () => {
  it("suma kingrow_retained SOLO de settlements liquidadas + transferidas", () => {
    const r = computeRevenue({
      settlements: [
        settlement({ kingrow_retained: 1000, status: "liquidada" }),
        settlement({ kingrow_retained: 2000, status: "transferida" }),
        settlement({ kingrow_retained: 9999, status: "abierta" }), // NO cuenta
      ],
      invoices: [],
      resolveOwnership: NO_OWNERSHIP,
    });
    expect(r.revenueFromSettlements).toBe(3000);
    expect(r.revenueTotal).toBe(3000);
  });

  it("borradores (abierta) NUNCA cuentan como ingreso realizado", () => {
    const r = computeRevenue({
      settlements: [
        settlement({ kingrow_retained: 5000, status: "abierta" }),
        settlement({ kingrow_retained: 5000, status: "abierta" }),
      ],
      invoices: [],
      resolveOwnership: NO_OWNERSHIP,
    });
    expect(r.revenueFromSettlements).toBe(0);
    expect(r.revenueTotal).toBe(0);
  });
});

describe("computeRevenue — clasificación de facturas", () => {
  it("kingrow-income (propia + sin launch) suma al ingreso, neto de IVA", () => {
    const r = computeRevenue({
      settlements: [],
      invoices: [
        invoice({
          project_id: "propia-1",
          launch_id: null,
          amount_gross: 12100,
          tax_amount: 2100,
        }),
      ],
      resolveOwnership: resolver({ "propia-1": "propia" }),
    });
    expect(r.revenueFromDirectSales).toBe(10000);
    expect(r.revenueTotal).toBe(10000);
    expect(r.groupVolumeFromInvoices).toBe(0);
    expect(r.thirdPartyFromInvoices).toBe(0);
  });

  it("group-volume (con launch) NO suma al ingreso, se expone aparte", () => {
    // Aunque el proyecto sea propio: la plata ya la contó la liquidación.
    const r = computeRevenue({
      settlements: [],
      invoices: [
        invoice({
          project_id: "propia-1",
          launch_id: "launch-1",
          amount_gross: 20000,
          tax_amount: 0,
        }),
      ],
      resolveOwnership: resolver({ "propia-1": "propia" }),
    });
    expect(r.revenueFromDirectSales).toBe(0);
    expect(r.revenueTotal).toBe(0);
    expect(r.groupVolumeFromInvoices).toBe(20000);
  });

  it("third-party (externa + sin launch) NO suma al ingreso", () => {
    const r = computeRevenue({
      settlements: [],
      invoices: [
        invoice({
          project_id: "externa-1",
          launch_id: null,
          amount_gross: 30000,
          tax_amount: 0,
        }),
      ],
      resolveOwnership: resolver({ "externa-1": "externa" }),
    });
    expect(r.revenueFromDirectSales).toBe(0);
    expect(r.revenueTotal).toBe(0);
    expect(r.thirdPartyFromInvoices).toBe(30000);
  });

  it("factura sin project_id (defecto de carga) cae a third-party", () => {
    // No inflamos el ingreso con datos incompletos. El caller lo cuenta
    // aparte como indicador de calidad de dato.
    const r = computeRevenue({
      settlements: [],
      invoices: [
        invoice({
          project_id: null,
          launch_id: null,
          amount_gross: 5000,
          tax_amount: 0,
        }),
      ],
      resolveOwnership: NO_OWNERSHIP,
    });
    expect(r.revenueFromDirectSales).toBe(0);
    expect(r.revenueTotal).toBe(0);
    expect(r.thirdPartyFromInvoices).toBe(5000);
  });

  it("solo cobradas cuentan; emitida/vencida/anulada quedan fuera de todas las magnitudes", () => {
    const r = computeRevenue({
      settlements: [],
      invoices: [
        invoice({
          project_id: "propia-1",
          amount_gross: 5000,
          status: "emitida",
        }),
        invoice({
          project_id: "propia-1",
          amount_gross: 8000,
          status: "vencida",
        }),
        invoice({
          project_id: "propia-1",
          amount_gross: 3000,
          status: "anulada",
        }),
      ],
      resolveOwnership: resolver({ "propia-1": "propia" }),
    });
    expect(r.revenueFromDirectSales).toBe(0);
    expect(r.groupVolumeFromInvoices).toBe(0);
    expect(r.thirdPartyFromInvoices).toBe(0);
  });

  it("ownership sin resolver → third-party (nunca inflar el ingreso)", () => {
    // Proyecto que el caller no pudo mapear (borrado, RLS, race). No lo
    // metemos como ingreso — se cae al balde seguro.
    const r = computeRevenue({
      settlements: [],
      invoices: [
        invoice({
          project_id: "huerfano",
          launch_id: null,
          amount_gross: 1000,
        }),
      ],
      resolveOwnership: NO_OWNERSHIP,
    });
    expect(r.revenueFromDirectSales).toBe(0);
    expect(r.thirdPartyFromInvoices).toBe(1000);
  });
});

describe("computeRevenue — caso mixto (empresa propia con ambos tipos)", () => {
  it("empresa propia con facturas de lanzamiento Y sueltas: solo las sueltas suman", () => {
    // Escenario del brief: Rey Academy tiene liquidación cerrada + factura
    // de ese mismo lanzamiento (group-volume, ya contada) + factura de
    // consultoría suelta (kingrow-income, nueva plata).
    const r = computeRevenue({
      settlements: [
        settlement({ kingrow_retained: 40000, status: "liquidada" }),
      ],
      invoices: [
        // Factura del mismo lanzamiento — la liquidación ya la contó
        invoice({
          project_id: "rey",
          launch_id: "launch-rey-1",
          amount_gross: 12100,
          tax_amount: 2100,
        }),
        // Consultoría suelta — plata que ninguna liquidación captura
        invoice({
          project_id: "rey",
          launch_id: null,
          amount_gross: 6050,
          tax_amount: 1050,
        }),
      ],
      resolveOwnership: resolver({ rey: "propia" }),
    });
    expect(r.revenueFromSettlements).toBe(40000);
    expect(r.revenueFromDirectSales).toBe(5000);
    expect(r.groupVolumeFromInvoices).toBe(10000);
    expect(r.revenueTotal).toBe(45000); // 40k + 5k, NUNCA 55k
  });
});

describe("computeRevenue — otros ingresos e input vacío", () => {
  it("otherIncome se suma tal cual", () => {
    const r = computeRevenue({
      settlements: [],
      invoices: [],
      resolveOwnership: NO_OWNERSHIP,
      otherIncome: 500,
    });
    expect(r.otherIncome).toBe(500);
    expect(r.revenueTotal).toBe(500);
  });

  it("input vacío → todo en 0", () => {
    const r = computeRevenue({
      settlements: [],
      invoices: [],
      resolveOwnership: NO_OWNERSHIP,
    });
    expect(r.revenueFromSettlements).toBe(0);
    expect(r.revenueFromDirectSales).toBe(0);
    expect(r.groupVolumeFromInvoices).toBe(0);
    expect(r.thirdPartyFromInvoices).toBe(0);
    expect(r.otherIncome).toBe(0);
    expect(r.revenueTotal).toBe(0);
  });
});
