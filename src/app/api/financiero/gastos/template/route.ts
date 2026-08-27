import { NextResponse } from "next/server";

import ExcelJS from "exceljs";

import { listExpenseCategories } from "@/lib/finance/expense-categories-repo";
import { createClient } from "@/lib/supabase/server";

/**
 * Plantilla xlsx para importar expenses.
 *
 * Obligatorio: Descripción, Bruto, Fecha.
 * Opcional: Categoría, IVA, Moneda, Vencimiento, Notas, Nº transacción.
 *
 * El Nº transacción sirve para pre-matchear el gasto contra un movimiento
 * bancario que traiga el mismo identificador — el drawer de vincular pago
 * lo sugiere primero cuando coincide.
 *
 * paid_at + bank_movement_id NO se importan — la conciliación se hace desde
 * la UI vinculando el gasto a un movimiento bancario.
 *
 * La hoja "Categorías" se genera desde `expense_categories` (0167) — refleja
 * el ABM del usuario, no una lista hardcodeada. Si no hay categorías (org
 * recién creada sin seed), la hoja queda vacía y el import acepta cualquier
 * string en esa columna (la DB es texto libre).
 */
export async function GET() {
  const supabase = await createClient();
  const categories = await listExpenseCategories(supabase);
  const activeCategories = categories.filter((c) => c.isActive);
  const seedExample = activeCategories[0];

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Kingrow";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Gastos");
  sheet.columns = [
    { header: "Descripción", key: "description", width: 34 },
    { header: "Categoría", key: "category", width: 16 },
    { header: "Bruto", key: "gross", width: 14, style: { numFmt: "#,##0.00" } },
    { header: "IVA", key: "tax", width: 12, style: { numFmt: "#,##0.00" } },
    { header: "Moneda", key: "currency", width: 10 },
    { header: "Fecha", key: "date", width: 14 },
    { header: "Vencimiento", key: "due", width: 14 },
    { header: "Notas", key: "notes", width: 36 },
    { header: "Nº transacción", key: "transaction_number", width: 22 },
  ];
  sheet.getRow(1).font = { bold: true };

  const example = sheet.addRow({
    description: "Ejemplo — Alquiler oficina julio",
    category: seedExample?.slug ?? "alquiler",
    gross: 250000,
    tax: 52500,
    currency: "ARS",
    date: new Date(),
    due: "",
    notes: "Borrá esta fila antes de subir",
    transaction_number: "TX-EJEMPLO-0001",
  });
  example.font = { italic: true, color: { argb: "FF888888" } };

  const refSheet = workbook.addWorksheet("Categorías");
  refSheet.columns = [
    { header: "Valor (poner en la hoja Gastos)", key: "value", width: 32 },
    { header: "Etiqueta", key: "label", width: 20 },
  ];
  refSheet.getRow(1).font = { bold: true };
  for (const c of activeCategories) {
    refSheet.addRow({ value: c.slug, label: c.label });
  }

  const buf = await workbook.xlsx.writeBuffer();
  return new NextResponse(new Uint8Array(buf) as unknown as BodyInit, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="gastos-plantilla.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
