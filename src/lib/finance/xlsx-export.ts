import "server-only";

import ExcelJS from "exceljs";

/**
 * Builders XLSX para los 4 exports del módulo financiero.
 *
 *   - bank_movements    → movimientos bancarios
 *   - client_transfers  → transferencias a clientes
 *   - launch_settlements → liquidaciones de launches
 *   - expenses          → gastos
 *
 * Shape de cada workbook = una hoja con headers + filas. No agrupamos,
 * no metemos totales — el usuario los calcula en Excel. Los nombres de
 * columnas espejan lo que ve en la UI (español, no snake_case) para que
 * un usuario no técnico entienda el archivo.
 *
 * Fechas: se serializan como Date objects (no strings) para que Excel
 * las reconozca como fecha y las formatee según el locale del usuario.
 * Montos: Number. El formato numérico va por columna.
 */

// ─── Bank movements ──────────────────────────────────────────────────────

export interface MovementExportRow {
  readonly date: string;
  readonly bankName: string;
  readonly projectName: string;
  readonly kind: "in" | "out";
  readonly amount: number;
  readonly description: string;
}

export async function buildMovementsWorkbook(
  rows: ReadonlyArray<MovementExportRow>,
): Promise<Uint8Array> {
  const workbook = newWorkbook();
  const sheet = workbook.addWorksheet("Movimientos");
  sheet.columns = [
    { header: "Fecha", key: "date", width: 12 },
    { header: "Banco", key: "bank", width: 24 },
    { header: "Proyecto", key: "project", width: 22 },
    { header: "Tipo", key: "kind", width: 10 },
    { header: "Monto", key: "amount", width: 16, style: MONEY_STYLE },
    { header: "Descripción", key: "description", width: 40 },
  ];
  for (const r of rows) {
    sheet.addRow({
      date: ymdToDate(r.date),
      bank: r.bankName,
      project: r.projectName,
      kind: r.kind === "in" ? "Entrada" : "Salida",
      amount: r.kind === "out" ? -r.amount : r.amount,
      description: r.description,
    });
  }
  boldHeader(sheet);
  return finalize(workbook);
}

// ─── Client transfers ────────────────────────────────────────────────────

export interface TransferExportRow {
  readonly date: string;
  readonly projectName: string;
  readonly direction: "a_favor_cliente" | "transferido";
  readonly amount: number;
  readonly hasSettlement: boolean;
  readonly hasBankMovement: boolean;
  readonly notes: string;
}

export async function buildTransfersWorkbook(
  rows: ReadonlyArray<TransferExportRow>,
): Promise<Uint8Array> {
  const workbook = newWorkbook();
  const sheet = workbook.addWorksheet("Transferencias");
  sheet.columns = [
    { header: "Fecha", key: "date", width: 12 },
    { header: "Proyecto", key: "project", width: 24 },
    { header: "Dirección", key: "direction", width: 22 },
    { header: "Monto", key: "amount", width: 16, style: MONEY_STYLE },
    { header: "Liquidación", key: "settlement", width: 12 },
    { header: "Mov. bancario", key: "bank_movement", width: 14 },
    { header: "Notas", key: "notes", width: 40 },
  ];
  for (const r of rows) {
    sheet.addRow({
      date: ymdToDate(r.date),
      project: r.projectName,
      direction:
        r.direction === "a_favor_cliente"
          ? "A favor del cliente"
          : "Transferido",
      amount: r.direction === "transferido" ? -r.amount : r.amount,
      settlement: r.hasSettlement ? "Sí" : "—",
      bank_movement: r.hasBankMovement ? "Sí" : "—",
      notes: r.notes,
    });
  }
  boldHeader(sheet);
  return finalize(workbook);
}

// ─── Launch settlements ──────────────────────────────────────────────────

export interface SettlementExportRow {
  readonly projectName: string;
  readonly launchName: string;
  readonly ownership: "propia" | "externa";
  readonly status: "abierta" | "liquidada" | "transferida";
  readonly collectedTotal: number;
  readonly kingrowRetained: number;
  readonly owedToClient: number;
  readonly ruleName: string;
  readonly createdAt: string;
  readonly closedAt: string | null;
}

export async function buildSettlementsWorkbook(
  rows: ReadonlyArray<SettlementExportRow>,
): Promise<Uint8Array> {
  const workbook = newWorkbook();
  const sheet = workbook.addWorksheet("Liquidaciones");
  sheet.columns = [
    { header: "Proyecto", key: "project", width: 22 },
    { header: "Lanzamiento", key: "launch", width: 26 },
    { header: "Ownership", key: "ownership", width: 12 },
    { header: "Estado", key: "status", width: 14 },
    { header: "Cobrado", key: "collected", width: 16, style: MONEY_STYLE },
    { header: "Kingrow retenido", key: "kingrow", width: 18, style: MONEY_STYLE },
    { header: "A cliente", key: "client", width: 16, style: MONEY_STYLE },
    { header: "Regla", key: "rule", width: 22 },
    { header: "Creada", key: "created", width: 12 },
    { header: "Cerrada", key: "closed", width: 12 },
  ];
  for (const r of rows) {
    sheet.addRow({
      project: r.projectName,
      launch: r.launchName,
      ownership: r.ownership === "externa" ? "Externa" : "Propia",
      status: statusLabel(r.status),
      collected: r.collectedTotal,
      kingrow: r.kingrowRetained,
      client: r.owedToClient,
      rule: r.ruleName,
      created: isoToDate(r.createdAt),
      closed: r.closedAt ? isoToDate(r.closedAt) : "",
    });
  }
  boldHeader(sheet);
  return finalize(workbook);
}

function statusLabel(s: "abierta" | "liquidada" | "transferida"): string {
  if (s === "abierta") return "Borrador";
  if (s === "liquidada") return "Liquidada";
  return "Transferida";
}

// ─── Expenses ────────────────────────────────────────────────────────────

export interface ExpenseExportRow {
  readonly expenseDate: string;
  readonly description: string;
  readonly category: string | null;
  readonly supplier: string;
  readonly amountGross: number;
  readonly taxAmount: number;
  readonly amountNet: number;
  readonly currency: string;
  readonly dueDate: string | null;
  readonly paidAt: string | null;
  readonly notes: string | null;
}

export async function buildExpensesWorkbook(
  rows: ReadonlyArray<ExpenseExportRow>,
): Promise<Uint8Array> {
  const workbook = newWorkbook();
  const sheet = workbook.addWorksheet("Gastos");
  sheet.columns = [
    { header: "Fecha", key: "date", width: 12 },
    { header: "Descripción", key: "description", width: 34 },
    { header: "Categoría", key: "category", width: 16 },
    { header: "Proveedor", key: "supplier", width: 22 },
    { header: "Bruto", key: "gross", width: 14, style: MONEY_STYLE },
    { header: "IVA", key: "tax", width: 12, style: MONEY_STYLE },
    { header: "Neto", key: "net", width: 14, style: MONEY_STYLE },
    { header: "Moneda", key: "currency", width: 8 },
    { header: "Vencimiento", key: "due", width: 12 },
    { header: "Pagado el", key: "paid", width: 12 },
    { header: "Notas", key: "notes", width: 40 },
  ];
  for (const r of rows) {
    sheet.addRow({
      date: ymdToDate(r.expenseDate),
      description: r.description,
      category: r.category ?? "",
      supplier: r.supplier,
      gross: r.amountGross,
      tax: r.taxAmount,
      net: r.amountNet,
      currency: r.currency,
      due: r.dueDate ? ymdToDate(r.dueDate) : "",
      paid: r.paidAt ? ymdToDate(r.paidAt) : "",
      notes: r.notes ?? "",
    });
  }
  boldHeader(sheet);
  return finalize(workbook);
}

// ─── internals ───────────────────────────────────────────────────────────

const MONEY_STYLE = {
  numFmt: '#,##0.00',
} as const;

function newWorkbook(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Kingrow";
  wb.created = new Date();
  return wb;
}

function boldHeader(sheet: ExcelJS.Worksheet): void {
  const row = sheet.getRow(1);
  row.font = { bold: true };
  row.alignment = { vertical: "middle" };
}

async function finalize(workbook: ExcelJS.Workbook): Promise<Uint8Array> {
  const buf = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buf);
}

/** yyyy-mm-dd → Date a las 00:00 local (Excel lo muestra sin hora). */
function ymdToDate(ymd: string): Date | string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(ymd)) return ymd;
  return new Date(`${ymd.slice(0, 10)}T00:00:00`);
}

/** ISO timestamptz → Date. */
function isoToDate(iso: string): Date | string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d;
}
