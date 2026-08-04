import "server-only";

import { Readable } from "node:stream";

import ExcelJS from "exceljs";

import {
  EXPENSE_CATEGORIES,
  type ExpenseCategory,
} from "./expense-categories";

/**
 * Parser de xlsx → filas listas para insertar en `bank_movements` y `expenses`.
 *
 * Diseño:
 *   - Streaming: usa `WorkbookReader` para no cargar el archivo entero.
 *   - Headers en español, tolerantes a mayúsculas/acentos/espacios.
 *   - Fechas: acepta Date de Excel o texto `YYYY-MM-DD` / `DD/MM/YYYY`.
 *   - Montos: acepta número o texto con coma/punto decimal.
 *   - Validación por fila con `rowNumber` 1-indexed (fila 1 = header, datos
 *     desde 2). Filas con error se acumulan y NO se insertan.
 *
 * Convención de la primera hoja: solo se lee "Movimientos" o "Gastos" (o la
 * primera hoja si no coinciden — misma lógica que leads).
 */

// ─── Movimientos ─────────────────────────────────────────────────────────

export interface MovementImportRow {
  readonly bank_id: string;
  readonly kind: "in" | "out";
  readonly amount: number;
  readonly occurred_at: string;
  readonly description: string | null;
}

export interface ParseError {
  readonly rowNumber: number;
  readonly reason: string;
}

export interface ParseResult<T> {
  readonly rows: ReadonlyArray<T>;
  readonly errors: ReadonlyArray<ParseError>;
  /** Total de filas de datos leídas (válidas + con error). */
  readonly totalRows: number;
}

/**
 * Parsea el workbook a payloads listos para insertar en bank_movements.
 * `banksByName` mapea nombres normalizados de banco → id. Un banco no
 * encontrado genera un error de fila (NO se inserta).
 */
export async function parseMovementsWorkbook(
  buffer: Buffer,
  banksByName: ReadonlyMap<string, string>,
): Promise<ParseResult<MovementImportRow>> {
  const rows: MovementImportRow[] = [];
  const errors: ParseError[] = [];
  let totalRows = 0;

  await readSheet(buffer, (record, rowNumber) => {
    totalRows++;
    const bankName = str(record["banco"]);
    if (!bankName) {
      errors.push({ rowNumber, reason: "Falta el banco." });
      return;
    }
    const bankId = banksByName.get(normalizeName(bankName));
    if (!bankId) {
      errors.push({
        rowNumber,
        reason: `Banco "${bankName}" no existe o no tenés acceso.`,
      });
      return;
    }

    const kindRaw = str(record["tipo"]).toLowerCase();
    const kind = parseKind(kindRaw);
    if (!kind) {
      errors.push({
        rowNumber,
        reason: `Tipo inválido: "${str(record["tipo"])}". Usá "Entrada" o "Salida".`,
      });
      return;
    }

    const amount = parseAmount(record["monto"]);
    if (amount == null || amount <= 0) {
      errors.push({
        rowNumber,
        reason: "El monto tiene que ser un número mayor a 0.",
      });
      return;
    }

    const occurredAt = parseYmd(record["fecha"]);
    if (!occurredAt) {
      errors.push({
        rowNumber,
        reason: "La fecha tiene que ser YYYY-MM-DD o una fecha de Excel.",
      });
      return;
    }

    const description = str(record["descripcion"]);
    rows.push({
      bank_id: bankId,
      kind,
      amount,
      occurred_at: occurredAt,
      description: description || null,
    });
  });

  return { rows, errors, totalRows };
}

// ─── Gastos ──────────────────────────────────────────────────────────────

export interface ExpenseImportRow {
  readonly description: string;
  readonly category: ExpenseCategory | null;
  readonly amount_gross: number;
  readonly tax_amount: number;
  readonly currency: string;
  readonly expense_date: string;
  readonly due_date: string | null;
  readonly notes: string | null;
}

export async function parseExpensesWorkbook(
  buffer: Buffer,
): Promise<ParseResult<ExpenseImportRow>> {
  const rows: ExpenseImportRow[] = [];
  const errors: ParseError[] = [];
  let totalRows = 0;

  await readSheet(buffer, (record, rowNumber) => {
    totalRows++;

    const description = str(record["descripcion"]);
    if (!description) {
      errors.push({ rowNumber, reason: "Falta la descripción." });
      return;
    }

    const amountGross = parseAmount(record["bruto"]);
    if (amountGross == null || amountGross < 0) {
      errors.push({
        rowNumber,
        reason: "El monto bruto tiene que ser un número >= 0.",
      });
      return;
    }

    const taxRaw = record["iva"];
    const taxAmount =
      taxRaw == null || String(taxRaw).trim() === ""
        ? 0
        : (parseAmount(taxRaw) ?? Number.NaN);
    if (!Number.isFinite(taxAmount) || taxAmount < 0) {
      errors.push({
        rowNumber,
        reason: "El IVA tiene que ser un número >= 0.",
      });
      return;
    }
    if (taxAmount > amountGross) {
      errors.push({
        rowNumber,
        reason: "El IVA no puede superar el monto bruto.",
      });
      return;
    }

    const expenseDate = parseYmd(record["fecha"]);
    if (!expenseDate) {
      errors.push({
        rowNumber,
        reason: "La fecha tiene que ser YYYY-MM-DD o una fecha de Excel.",
      });
      return;
    }

    const dueRaw = record["vencimiento"];
    let dueDate: string | null = null;
    if (dueRaw != null && String(dueRaw).trim() !== "") {
      const parsed = parseYmd(dueRaw);
      if (!parsed) {
        errors.push({
          rowNumber,
          reason: "La fecha de vencimiento no es válida.",
        });
        return;
      }
      dueDate = parsed;
    }

    const categoryRaw = str(record["categoria"]).toLowerCase();
    const category = (EXPENSE_CATEGORIES as readonly string[]).includes(
      categoryRaw,
    )
      ? (categoryRaw as ExpenseCategory)
      : null;

    const currencyRaw = str(record["moneda"]).toUpperCase();
    const currency = currencyRaw || "ARS";

    const notes = str(record["notas"]);

    rows.push({
      description,
      category,
      amount_gross: amountGross,
      tax_amount: taxAmount,
      currency,
      expense_date: expenseDate,
      due_date: dueDate,
      notes: notes || null,
    });
  });

  return { rows, errors, totalRows };
}

// ─── shared ──────────────────────────────────────────────────────────────

/**
 * Itera la primera hoja del workbook en streaming. `record` viene con keys
 * ya normalizados (lowercase, sin acentos). Ignora filas totalmente vacías.
 */
async function readSheet(
  buffer: Buffer,
  onRow: (record: Record<string, unknown>, rowNumber: number) => void,
): Promise<void> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(toReadable(buffer), {
    sharedStrings: "cache",
    hyperlinks: "ignore",
    styles: "ignore",
    worksheets: "emit",
    entries: "ignore",
  });

  let headers: string[] | null = null;
  let firstSheetDone = false;

  for await (const worksheet of reader) {
    if (firstSheetDone) continue;
    firstSheetDone = true;

    for await (const row of worksheet) {
      if (row.number === 1) {
        headers = extractHeaders(row);
        continue;
      }
      if (!headers) continue;
      const record = rowToRecord(row, headers);
      if (isEmpty(record)) continue;
      onRow(record, row.number);
    }
  }
}

function extractHeaders(row: ExcelJS.Row): string[] {
  const headers: string[] = [];
  row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headers[colNumber - 1] = normalizeName(String(rawCell(cell)));
  });
  for (let i = 0; i < headers.length; i++) {
    if (headers[i] === undefined) headers[i] = `__col_${i + 1}`;
  }
  return headers;
}

function rowToRecord(
  row: ExcelJS.Row,
  headers: ReadonlyArray<string>,
): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const key = headers[colNumber - 1];
    if (!key) return;
    record[key] = rawCell(cell);
  });
  return record;
}

/**
 * Devuelve el valor "más útil" de la celda para nuestro parsing:
 *   - number, boolean, string → tal cual
 *   - Date → Date
 *   - formulas / rich text / hyperlinks → texto plano
 */
function rawCell(cell: ExcelJS.Cell): unknown {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if ("text" in v && typeof v.text === "string") return v.text;
    if ("result" in v && v.result !== null && v.result !== undefined) {
      const r = v.result as unknown;
      if (r instanceof Date) return r;
      return r;
    }
    if ("richText" in v && Array.isArray(v.richText)) {
      return v.richText.map((r: { text: string }) => r.text).join("");
    }
    if ("hyperlink" in v && typeof v.hyperlink === "string") {
      return "text" in v && typeof v.text === "string" ? v.text : v.hyperlink;
    }
  }
  return String(v);
}

function isEmpty(record: Record<string, unknown>): boolean {
  for (const k of Object.keys(record)) {
    const v = record[k];
    if (v === null || v === undefined) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    return false;
  }
  return true;
}

function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}

/**
 * Normaliza un header/nombre: lowercase, sin acentos, sin espacios extra.
 * "Descripción" → "descripcion", "Fecha " → "fecha".
 */
export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function parseKind(v: string): "in" | "out" | null {
  if (v === "in" || v === "entrada" || v === "ingreso") return "in";
  if (v === "out" || v === "salida" || v === "egreso") return "out";
  return null;
}

/**
 * Convierte un valor de celda a un número. Acepta:
 *   - number nativo
 *   - "12500", "12.500,00", "12,500.00", "12500.5" — el formato mixto ES/EN
 *     es común en exports argentinos. Estrategia: si tiene coma Y punto, la
 *     última posición manda como separador decimal; si solo hay coma, coma
 *     es decimal; si solo hay punto, punto es decimal.
 */
export function parseAmount(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (s === "") return null;
  const cleaned = s.replace(/\s/g, "");
  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");
  let normalized: string;
  if (hasComma && hasDot) {
    const lastComma = cleaned.lastIndexOf(",");
    const lastDot = cleaned.lastIndexOf(".");
    if (lastComma > lastDot) {
      normalized = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = cleaned.replace(/,/g, "");
    }
  } else if (hasComma) {
    normalized = cleaned.replace(",", ".");
  } else {
    normalized = cleaned;
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/**
 * Convierte un valor de celda a YYYY-MM-DD. Acepta:
 *   - Date (Excel date-typed)
 *   - "YYYY-MM-DD" o "YYYY/MM/DD"
 *   - "DD/MM/YYYY" o "DD-MM-YYYY" (formato local ES)
 *   - ISO timestamp (recortamos a los primeros 10 chars)
 */
export function parseYmd(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) {
    if (!Number.isFinite(v.getTime())) return null;
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  }
  const s = String(v).trim();
  if (s === "") return null;

  // YYYY-MM-DD o ISO
  const isoMatch = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]);
    const d = Number(isoMatch[3]);
    if (isValidYmd(y, m, d)) return `${y}-${pad(m)}-${pad(d)}`;
  }
  // DD/MM/YYYY o DD-MM-YYYY
  const dmyMatch = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmyMatch) {
    const d = Number(dmyMatch[1]);
    const m = Number(dmyMatch[2]);
    const y = Number(dmyMatch[3]);
    if (isValidYmd(y, m, d)) return `${y}-${pad(m)}-${pad(d)}`;
  }
  return null;
}

function isValidYmd(y: number, m: number, d: number): boolean {
  if (!Number.isInteger(y) || y < 1970 || y > 2100) return false;
  if (!Number.isInteger(m) || m < 1 || m > 12) return false;
  if (!Number.isInteger(d) || d < 1 || d > 31) return false;
  return true;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function toReadable(buffer: Buffer): Readable {
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);
  return stream;
}
