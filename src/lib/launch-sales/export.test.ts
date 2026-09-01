import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { buildProjectSalesWorkbook } from "./export";
import type { SaleExportRow, SalesExportMeta } from "./export-types";

/**
 * Smoke tests del export de Ventas. Lo que importa verificar acá:
 *   - Los headers salen en el orden esperado y `hideCommission` saca las DOS
 *     columnas de comisión (no solo el valor) — si sacara una sola, todas las
 *     columnas de la derecha quedarían corridas.
 *   - Los montos se escriben como Number, no como string formateado: es la
 *     razón de ser del export (pivotear en Excel).
 *   - Un `pledgedUsd` null no se convierte en 0 (mentiría sobre el revenue).
 */

const BASE_ROW: SaleExportRow = {
  student: "Juan Pérez",
  email: "juan@example.com",
  phone: "+5491155555555",
  contact: "juan@example.com",
  product: "Mentoría 6m",
  launch: "Lanzamiento Marzo",
  seller: "Ana Closer",
  method: "Transferencia",
  currency: "ARS",
  pledged: 1_500_000,
  collected: 500_000,
  collectedCurrency: "ARS",
  mixedCurrency: false,
  commission: 75_000,
  commissionCurrency: "ARS",
  status: "partial",
  pledgedUsd: 1200,
  collectedUsd: 400,
  paymentCount: 1,
  installmentCount: 6,
  closedAt: "2026-03-15T12:00:00Z",
};

const META: SalesExportMeta = {
  filters: [],
  hideCommission: false,
};

async function readBack(
  rows: ReadonlyArray<SaleExportRow>,
  meta: SalesExportMeta,
): Promise<ExcelJS.Workbook> {
  const buffer = await buildProjectSalesWorkbook(rows, meta);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb;
}

function headersOf(sheet: ExcelJS.Worksheet): string[] {
  const out: string[] = [];
  sheet.getRow(1).eachCell((cell) => out.push(String(cell.value ?? "")));
  return out;
}

describe("buildProjectSalesWorkbook", () => {
  it("arma las hojas Ventas y Resumen", async () => {
    const wb = await readBack([BASE_ROW], META);
    expect(wb.worksheets.map((s) => s.name)).toEqual(["Ventas", "Resumen"]);
  });

  it("escribe montos como Number y la fecha como Date", async () => {
    const wb = await readBack([BASE_ROW], META);
    const sheet = wb.getWorksheet("Ventas")!;
    const headers = headersOf(sheet);
    const row = sheet.getRow(2);
    const cell = (header: string) => row.getCell(headers.indexOf(header) + 1).value;

    expect(cell("Monto pactado")).toBe(1_500_000);
    expect(cell("Monto cobrado")).toBe(500_000);
    expect(cell("Comisión")).toBe(75_000);
    expect(cell("Moneda")).toBe("ARS");
    expect(cell("Email")).toBe("juan@example.com");
    expect(cell("Teléfono")).toBe("+5491155555555");
    expect(cell("Contacto")).toBe("juan@example.com");
    expect(cell("Estado de cobro")).toBe("Parcial");
    expect(cell("Cierre")).toBeInstanceOf(Date);
  });

  it("saca las dos columnas de comisión con hideCommission", async () => {
    const wb = await readBack([BASE_ROW], { ...META, hideCommission: true });
    const headers = headersOf(wb.getWorksheet("Ventas")!);

    expect(headers).not.toContain("Comisión");
    expect(headers).not.toContain("Moneda comisión");
    // La columna siguiente no quedó corrida: sigue habiendo un valor válido.
    const row = wb.getWorksheet("Ventas")!.getRow(2);
    expect(row.getCell(headers.indexOf("Estado de cobro") + 1).value).toBe("Parcial");
    expect(row.getCell(headers.indexOf("Pactado (USD)") + 1).value).toBe(1200);
  });

  it("deja vacío (no 0) el USD cuando falta la tasa FX", async () => {
    const wb = await readBack([{ ...BASE_ROW, pledgedUsd: null, collectedUsd: null }], META);
    const sheet = wb.getWorksheet("Ventas")!;
    const headers = headersOf(sheet);
    const row = sheet.getRow(2);

    expect(row.getCell(headers.indexOf("Pactado (USD)") + 1).value).toBeFalsy();
    expect(row.getCell(headers.indexOf("Pactado (USD)") + 1).value).not.toBe(0);
  });

  it("totaliza en el Resumen y lista los filtros aplicados", async () => {
    const wb = await readBack([BASE_ROW, { ...BASE_ROW, pledgedUsd: 800, collectedUsd: 100 }], {
      ...META,
      filters: ['Búsqueda: "juan"', "Estado de cobro: Parcial"],
    });
    const sheet = wb.getWorksheet("Resumen")!;
    const labels: string[] = [];
    const values: unknown[] = [];
    sheet.eachRow((row) => {
      labels.push(String(row.getCell(1).value ?? ""));
      values.push(row.getCell(2).value);
    });

    expect(values[labels.indexOf("Total pactado (USD)")]).toBe(2000);
    expect(values[labels.indexOf("Total cobrado (USD)")]).toBe(500);
    expect(values[labels.indexOf("Ventas exportadas")]).toBe(2);
    expect(labels).toContain('Búsqueda: "juan"');
  });
});
