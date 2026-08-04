import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import {
  parseExpensesWorkbook,
  parseMovementsWorkbook,
} from "./xlsx-import";

/**
 * Smoke tests del parser xlsx. El objetivo NO es cubrir el 100% del comportamiento
 * — es verificar que la detección de headers reconoce archivos generados con la
 * misma técnica que nuestras plantillas (`sheet.columns = [{header, key}]` +
 * bold en fila 1), y que aliases comunes funcionan.
 *
 * El bug histórico que motivó estos tests: extractHeaders devolvía objetos en
 * vez de strings para cells con shape rico → error "[object Object]" en UI.
 */

async function makeWorkbook(
  build: (sheet: ExcelJS.Worksheet) => void,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Movimientos");
  build(sheet);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

describe("parseMovementsWorkbook", () => {
  it("lee headers cuando se generan con sheet.columns y bold", async () => {
    const buffer = await makeWorkbook((sheet) => {
      sheet.columns = [
        { header: "Banco", key: "bank", width: 24 },
        { header: "Tipo", key: "kind", width: 12 },
        { header: "Monto", key: "amount", width: 14 },
        { header: "Fecha", key: "date", width: 14 },
        { header: "Descripción", key: "description", width: 36 },
      ];
      sheet.getRow(1).font = { bold: true };
      const row = sheet.addRow({
        bank: "Galicia",
        kind: "Salida",
        amount: 12500,
        date: new Date("2026-08-01"),
        description: "Test",
      });
      row.font = { italic: true };
    });

    const banksByName = new Map<string, string>([["galicia", "bank-id-1"]]);
    const result = await parseMovementsWorkbook(buffer, banksByName);
    expect(result.headerError).toBeUndefined();
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      bank_id: "bank-id-1",
      kind: "out",
      amount: 12500,
      occurred_at: "2026-08-01",
      description: "Test",
    });
  });

  it("acepta aliases comunes en los headers", async () => {
    const buffer = await makeWorkbook((sheet) => {
      sheet.addRow(["Cuenta", "Movimiento", "Importe", "Fecha operacion"]);
      sheet.addRow(["Galicia", "Entrada", "5000", "2026-08-02"]);
    });

    const banksByName = new Map<string, string>([["galicia", "bank-id-1"]]);
    const result = await parseMovementsWorkbook(buffer, banksByName);
    expect(result.headerError).toBeUndefined();
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].amount).toBe(5000);
    expect(result.rows[0].kind).toBe("in");
  });

  it("devuelve headerError cuando falta una columna requerida", async () => {
    const buffer = await makeWorkbook((sheet) => {
      // "Fecha" ausente
      sheet.addRow(["Banco", "Tipo", "Monto"]);
      sheet.addRow(["Galicia", "Entrada", "5000"]);
    });

    const banksByName = new Map<string, string>([["galicia", "bank-id-1"]]);
    const result = await parseMovementsWorkbook(buffer, banksByName);
    expect(result.headerError).toBeDefined();
    expect(result.headerError).toContain("Fecha");
    expect(result.rows).toEqual([]);
  });

  it("acumula todos los errores por fila en un mismo mensaje", async () => {
    const buffer = await makeWorkbook((sheet) => {
      sheet.addRow(["Banco", "Tipo", "Monto", "Fecha"]);
      sheet.addRow(["Ninguno", "Volquete", "abc", "no-fecha"]);
    });

    const banksByName = new Map<string, string>([["galicia", "bank-id-1"]]);
    const result = await parseMovementsWorkbook(buffer, banksByName);
    expect(result.rows).toEqual([]);
    expect(result.errors).toHaveLength(1);
    const reason = result.errors[0].reason;
    expect(reason).toContain("Banco");
    expect(reason).toContain("Tipo");
    expect(reason).toContain("Monto");
    expect(reason).toContain("Fecha");
  });
});

describe("parseExpensesWorkbook", () => {
  it("lee headers y filas de la plantilla oficial", async () => {
    const buffer = await makeWorkbook((sheet) => {
      sheet.columns = [
        { header: "Descripción", key: "description", width: 34 },
        { header: "Categoría", key: "category", width: 16 },
        { header: "Bruto", key: "gross", width: 14 },
        { header: "IVA", key: "tax", width: 12 },
        { header: "Moneda", key: "currency", width: 10 },
        { header: "Fecha", key: "date", width: 14 },
        { header: "Vencimiento", key: "due", width: 14 },
        { header: "Notas", key: "notes", width: 36 },
      ];
      sheet.getRow(1).font = { bold: true };
      sheet.addRow({
        description: "Alquiler",
        category: "alquiler",
        gross: 250000,
        tax: 52500,
        currency: "ARS",
        date: new Date("2026-07-01"),
        due: "",
        notes: "",
      });
    });

    const result = await parseExpensesWorkbook(buffer);
    expect(result.headerError).toBeUndefined();
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      description: "Alquiler",
      category: "alquiler",
      amount_gross: 250000,
      tax_amount: 52500,
      currency: "ARS",
      expense_date: "2026-07-01",
    });
  });
});
