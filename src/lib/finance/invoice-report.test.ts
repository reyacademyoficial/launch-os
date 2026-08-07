import { describe, expect, it } from "vitest";

import {
  buildInvoiceReport,
  effectiveStatus,
  type InvoiceInput,
} from "./invoice-report";

function makeInv(overrides: Partial<InvoiceInput> = {}): InvoiceInput {
  return {
    id: "i-1",
    status: "emitida",
    issue_date: "2026-08-01",
    due_date: "2026-08-15",
    amount_gross: 1000,
    currency: "ARS",
    project_id: null,
    invoice_number: "0000001",
    buyer_name: null,
    description: "test",
    ...overrides,
  };
}

describe("effectiveStatus", () => {
  it("emitida con due_date < today → vencida", () => {
    expect(effectiveStatus("emitida", "2026-07-01", "2026-08-07")).toBe(
      "vencida",
    );
  });

  it("emitida con due_date >= today → emitida", () => {
    expect(effectiveStatus("emitida", "2026-08-07", "2026-08-07")).toBe(
      "emitida",
    );
  });

  it("cobrada permanece cobrada aunque due_date sea vieja", () => {
    expect(effectiveStatus("cobrada", "2026-01-01", "2026-08-07")).toBe(
      "cobrada",
    );
  });

  it("anulada permanece anulada", () => {
    expect(effectiveStatus("anulada", "2026-01-01", "2026-08-07")).toBe(
      "anulada",
    );
  });

  it("emitida sin due_date → emitida", () => {
    expect(effectiveStatus("emitida", null, "2026-08-07")).toBe("emitida");
  });
});

describe("buildInvoiceReport", () => {
  it("agrupa por status × moneda con count / gross / gatewayFee", () => {
    const invs: InvoiceInput[] = [
      makeInv({ id: "i-1", status: "cobrada", amount_gross: 1000, currency: "ARS" }),
      makeInv({ id: "i-2", status: "cobrada", amount_gross: 500, currency: "ARS" }),
      makeInv({ id: "i-3", status: "emitida", amount_gross: 300, currency: "USD", due_date: "2026-09-01" }),
      makeInv({ id: "i-4", status: "anulada", amount_gross: 200, currency: "ARS" }),
    ];
    const principals = new Map<string, number>([
      ["i-1", 970],
      ["i-2", 500],
    ]);
    const rep = buildInvoiceReport(invs, principals, "2026-08-07");

    const cobradaArs = rep.buckets.find(
      (b) => b.status === "cobrada" && b.currency === "ARS",
    );
    expect(cobradaArs?.count).toBe(2);
    expect(cobradaArs?.amountGross).toBe(1500);
    expect(cobradaArs?.gatewayFee).toBe(30); // (1000-970)+(500-500)

    const emitidaUsd = rep.buckets.find(
      (b) => b.status === "emitida" && b.currency === "USD",
    );
    expect(emitidaUsd?.count).toBe(1);
    expect(emitidaUsd?.gatewayFee).toBe(0); // sin principal linkeado

    const anulada = rep.buckets.find((b) => b.status === "anulada");
    expect(anulada?.count).toBe(1);
  });

  it("emitida vencida se reclasifica correctamente en el bucket", () => {
    const invs: InvoiceInput[] = [
      makeInv({ id: "i-1", status: "emitida", due_date: "2026-01-01", amount_gross: 100, currency: "ARS" }),
    ];
    const rep = buildInvoiceReport(invs, new Map(), "2026-08-07");
    expect(rep.buckets.find((b) => b.status === "vencida")?.count).toBe(1);
    expect(rep.buckets.find((b) => b.status === "emitida")).toBeUndefined();
    expect(rep.detail[0]?.status).toBe("vencida");
  });

  it("gatewayFee null cuando no hay principal linkeado", () => {
    const invs: InvoiceInput[] = [makeInv({ id: "i-1", amount_gross: 100 })];
    const rep = buildInvoiceReport(invs, new Map(), "2026-08-07");
    expect(rep.detail[0]?.gatewayFee).toBeNull();
  });
});
