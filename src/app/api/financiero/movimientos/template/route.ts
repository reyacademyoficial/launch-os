import { NextResponse } from "next/server";

import { listBanks } from "@/lib/banks/list";
import ExcelJS from "exceljs";

/**
 * Plantilla xlsx para importar bank_movements.
 *
 * Columnas obligatorias:
 *   - Banco     → texto, matchea contra banks.name (case-insensitive)
 *   - Tipo      → "Entrada" | "Salida"
 *   - Monto     → número > 0 (siempre positivo, el signo lo da Tipo)
 *   - Fecha     → date (Excel reconoce el date-typed) o texto YYYY-MM-DD
 * Opcional:
 *   - Descripción     → texto
 *   - Nº transacción  → texto, el id que da el banco / pasarela. Cuando
 *                       matchea con el mismo Nº transacción de un gasto o
 *                       factura, el drawer de conciliación lo sugiere primero.
 *
 * En la hoja "Bancos disponibles" se listan los bancos activos para que el
 * usuario copie el nombre exacto (evita typos que rompen el match).
 */
interface BankRow {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
}

export async function GET() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Kingrow";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Movimientos");
  sheet.columns = [
    { header: "Banco", key: "bank", width: 24 },
    { header: "Tipo", key: "kind", width: 12 },
    { header: "Monto", key: "amount", width: 14, style: { numFmt: "#,##0.00" } },
    { header: "Fecha", key: "date", width: 14 },
    { header: "Descripción", key: "description", width: 36 },
    { header: "Nº transacción", key: "transaction_number", width: 22 },
  ];
  sheet.getRow(1).font = { bold: true };

  // Fila de ejemplo (comentada visualmente con estilo diferente).
  const example = sheet.addRow({
    bank: "Ejemplo Banco Galicia",
    kind: "Salida",
    amount: 12500,
    date: new Date(),
    description: "Ejemplo — borrá esta fila antes de subir",
    transaction_number: "TX-EJEMPLO-0001",
  });
  example.font = { italic: true, color: { argb: "FF888888" } };

  // Hoja de referencia con los bancos activos.
  const banks = (await listBanks().catch(() => [])) as unknown as BankRow[];
  const refSheet = workbook.addWorksheet("Bancos disponibles");
  refSheet.columns = [
    { header: "Nombre del banco", key: "name", width: 28 },
    { header: "Estado", key: "active", width: 12 },
  ];
  refSheet.getRow(1).font = { bold: true };
  for (const b of banks) {
    refSheet.addRow({ name: b.name, active: b.active ? "Activo" : "Inactivo" });
  }

  const buf = await workbook.xlsx.writeBuffer();
  return new NextResponse(new Uint8Array(buf) as unknown as BodyInit, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition":
        'attachment; filename="movimientos-plantilla.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
