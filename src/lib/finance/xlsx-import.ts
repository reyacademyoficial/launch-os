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
  /** Si no se pudieron reconocer los headers, va acá y `rows` queda vacío. */
  readonly headerError?: string;
}

/**
 * Aliases aceptados para cada campo. Los headers del archivo se normalizan
 * (lower, sin acentos, sin espacios extra) antes de comparar. La búsqueda es
 * "primer alias que aparezca en el archivo" — la plantilla siempre gana porque
 * su header exacto está primero en cada lista.
 */
const MOVEMENT_ALIASES: Record<
  "banco" | "tipo" | "monto" | "fecha" | "descripcion",
  ReadonlyArray<string>
> = {
  banco: ["banco", "banco nombre", "nombre del banco", "cuenta", "cuenta bancaria"],
  tipo: ["tipo", "tipo movimiento", "movimiento", "operacion", "kind"],
  monto: ["monto", "importe", "valor", "total", "amount"],
  fecha: [
    "fecha",
    "fecha operacion",
    "fecha de operacion",
    "fecha movimiento",
    "date",
  ],
  descripcion: ["descripcion", "detalle", "concepto", "description", "notas"],
};

const MOVEMENT_REQUIRED: ReadonlyArray<
  keyof typeof MOVEMENT_ALIASES
> = ["banco", "tipo", "monto", "fecha"];

const EXPENSE_ALIASES: Record<
  | "descripcion"
  | "categoria"
  | "bruto"
  | "iva"
  | "moneda"
  | "fecha"
  | "vencimiento"
  | "notas",
  ReadonlyArray<string>
> = {
  descripcion: ["descripcion", "detalle", "concepto", "description"],
  categoria: ["categoria", "rubro", "category"],
  bruto: ["bruto", "monto bruto", "importe", "total", "amount"],
  iva: ["iva", "impuesto", "tax"],
  moneda: ["moneda", "divisa", "currency"],
  fecha: ["fecha", "fecha gasto", "fecha del gasto", "date"],
  vencimiento: ["vencimiento", "vence", "due", "due date"],
  notas: ["notas", "observaciones", "notes"],
};

const EXPENSE_REQUIRED: ReadonlyArray<
  keyof typeof EXPENSE_ALIASES
> = ["descripcion", "bruto", "fecha"];

/**
 * Dado los headers detectados en el archivo y el mapa de aliases por campo,
 * devuelve `{ campo → headerReal }`. Si un campo no matchea, entra como null.
 * Un mismo header no se asigna a dos campos distintos: gana el primer campo
 * que lo reclame (los required se resuelven antes que los optional en el caller).
 */
function resolveHeaderMap<K extends string>(
  headers: ReadonlyArray<string>,
  aliases: Record<K, ReadonlyArray<string>>,
): Record<K, string | null> {
  const claimed = new Set<string>();
  const map = {} as Record<K, string | null>;
  for (const field of Object.keys(aliases) as K[]) {
    let hit: string | null = null;
    for (const alias of aliases[field]) {
      if (headers.includes(alias) && !claimed.has(alias)) {
        hit = alias;
        break;
      }
    }
    map[field] = hit;
    if (hit) claimed.add(hit);
  }
  return map;
}

function humanHeaders(headers: ReadonlyArray<string>): string {
  const visible = headers.filter((h) => !h.startsWith("__col_"));
  return visible.length === 0 ? "(ninguno)" : visible.join(", ");
}

/**
 * Parsea el workbook a payloads listos para insertar en bank_movements.
 * `banksByName` mapea nombres normalizados de banco → id. Un banco no
 * encontrado genera un error de fila (NO se inserta).
 *
 * Recolecta TODOS los errores de una fila antes de descartarla — así el
 * usuario ve de una todo lo que hay que arreglar en esa fila, no de a uno.
 */
export async function parseMovementsWorkbook(
  buffer: Buffer,
  banksByName: ReadonlyMap<string, string>,
): Promise<ParseResult<MovementImportRow>> {
  const rows: MovementImportRow[] = [];
  const errors: ParseError[] = [];
  let totalRows = 0;
  let headerError: string | null = null;
  let colBanco: string | null = null;
  let colTipo: string | null = null;
  let colMonto: string | null = null;
  let colFecha: string | null = null;
  let colDescripcion: string | null = null;

  const bankNamesVisible = Array.from(banksByName.keys());

  await readSheet(
    buffer,
    (headers) => {
      const map = resolveHeaderMap(headers, MOVEMENT_ALIASES);
      colBanco = map.banco;
      colTipo = map.tipo;
      colMonto = map.monto;
      colFecha = map.fecha;
      colDescripcion = map.descripcion;
      const missing: string[] = [];
      for (const req of MOVEMENT_REQUIRED) {
        if (!map[req]) missing.push(capitalize(req));
      }
      if (missing.length > 0) {
        headerError = `Falta${missing.length > 1 ? "n" : ""} la${
          missing.length > 1 ? "s" : ""
        } columna${missing.length > 1 ? "s" : ""}: ${missing.join(
          ", ",
        )}. Detecté: ${humanHeaders(
          headers,
        )}. Usá los headers de la plantilla (Banco, Tipo, Monto, Fecha, Descripción).`;
      }
    },
    (record, rowNumber) => {
      if (headerError) return;
      totalRows++;
      const rowErrors: string[] = [];

      let bankId: string | null = null;
      const bankNameRaw = colBanco ? str(record[colBanco]) : "";
      if (!bankNameRaw) {
        rowErrors.push("Falta el banco");
      } else {
        const found = banksByName.get(normalizeName(bankNameRaw));
        if (!found) {
          const options =
            bankNamesVisible.length > 0
              ? ` Bancos disponibles: ${bankNamesVisible.join(", ")}.`
              : "";
          rowErrors.push(
            `Banco "${bankNameRaw}" no coincide con ninguno cargado.${options}`,
          );
        } else {
          bankId = found;
        }
      }

      let kind: "in" | "out" | null = null;
      const kindRaw = colTipo ? str(record[colTipo]) : "";
      if (!kindRaw) {
        rowErrors.push('Falta el tipo (usá "Entrada" o "Salida")');
      } else {
        const parsedKind = parseKind(kindRaw.toLowerCase());
        if (!parsedKind) {
          rowErrors.push(
            `Tipo "${kindRaw}" inválido (usá "Entrada" o "Salida")`,
          );
        } else {
          kind = parsedKind;
        }
      }

      const amount = colMonto ? parseAmount(record[colMonto]) : null;
      if (amount == null || amount <= 0) {
        rowErrors.push("Monto tiene que ser un número mayor a 0");
      }

      const occurredAt = colFecha ? parseYmd(record[colFecha]) : null;
      if (!occurredAt) {
        rowErrors.push(
          "Fecha inválida (usá YYYY-MM-DD, DD/MM/YYYY o una fecha de Excel)",
        );
      }

      if (rowErrors.length > 0) {
        errors.push({ rowNumber, reason: rowErrors.join(" · ") });
        return;
      }

      const description = colDescripcion ? str(record[colDescripcion]) : "";
      rows.push({
        bank_id: bankId as string,
        kind: kind as "in" | "out",
        amount: amount as number,
        occurred_at: occurredAt as string,
        description: description || null,
      });
    },
  );

  if (headerError) {
    return {
      rows: [],
      errors: [],
      totalRows: 0,
      headerError,
    };
  }
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
  let headerError: string | null = null;

  let colDescripcion: string | null = null;
  let colCategoria: string | null = null;
  let colBruto: string | null = null;
  let colIva: string | null = null;
  let colMoneda: string | null = null;
  let colFecha: string | null = null;
  let colVencimiento: string | null = null;
  let colNotas: string | null = null;

  await readSheet(
    buffer,
    (headers) => {
      const map = resolveHeaderMap(headers, EXPENSE_ALIASES);
      colDescripcion = map.descripcion;
      colCategoria = map.categoria;
      colBruto = map.bruto;
      colIva = map.iva;
      colMoneda = map.moneda;
      colFecha = map.fecha;
      colVencimiento = map.vencimiento;
      colNotas = map.notas;
      const missing: string[] = [];
      for (const req of EXPENSE_REQUIRED) {
        if (!map[req]) missing.push(capitalize(req));
      }
      if (missing.length > 0) {
        headerError = `Falta${missing.length > 1 ? "n" : ""} la${
          missing.length > 1 ? "s" : ""
        } columna${missing.length > 1 ? "s" : ""}: ${missing.join(
          ", ",
        )}. Detecté: ${humanHeaders(
          headers,
        )}. Usá los headers de la plantilla (Descripción, Categoría, Bruto, IVA, Moneda, Fecha, Vencimiento, Notas).`;
      }
    },
    (record, rowNumber) => {
      if (headerError) return;
      totalRows++;
      const rowErrors: string[] = [];

      const description = colDescripcion ? str(record[colDescripcion]) : "";
      if (!description) {
        rowErrors.push("Falta la descripción");
      }

      const amountGross = colBruto ? parseAmount(record[colBruto]) : null;
      if (amountGross == null || amountGross < 0) {
        rowErrors.push("Bruto tiene que ser un número >= 0");
      }

      const taxRaw = colIva ? record[colIva] : undefined;
      const taxParsed =
        taxRaw == null || String(taxRaw).trim() === ""
          ? 0
          : parseAmount(taxRaw);
      const taxAmount = taxParsed == null ? Number.NaN : taxParsed;
      if (!Number.isFinite(taxAmount) || taxAmount < 0) {
        rowErrors.push("IVA tiene que ser un número >= 0");
      } else if (amountGross != null && taxAmount > amountGross) {
        rowErrors.push("IVA no puede superar el monto bruto");
      }

      const expenseDate = colFecha ? parseYmd(record[colFecha]) : null;
      if (!expenseDate) {
        rowErrors.push(
          "Fecha inválida (usá YYYY-MM-DD, DD/MM/YYYY o una fecha de Excel)",
        );
      }

      const dueRaw = colVencimiento ? record[colVencimiento] : undefined;
      let dueDate: string | null = null;
      if (dueRaw != null && String(dueRaw).trim() !== "") {
        const parsed = parseYmd(dueRaw);
        if (!parsed) {
          rowErrors.push("Vencimiento inválido");
        } else {
          dueDate = parsed;
        }
      }

      if (rowErrors.length > 0) {
        errors.push({ rowNumber, reason: rowErrors.join(" · ") });
        return;
      }

      const categoryRaw = colCategoria
        ? str(record[colCategoria]).toLowerCase()
        : "";
      const category = (EXPENSE_CATEGORIES as readonly string[]).includes(
        categoryRaw,
      )
        ? (categoryRaw as ExpenseCategory)
        : null;

      const currencyRaw = colMoneda
        ? str(record[colMoneda]).toUpperCase()
        : "";
      const currency = currencyRaw || "ARS";

      const notes = colNotas ? str(record[colNotas]) : "";

      rows.push({
        description,
        category,
        amount_gross: amountGross as number,
        tax_amount: taxAmount,
        currency,
        expense_date: expenseDate as string,
        due_date: dueDate,
        notes: notes || null,
      });
    },
  );

  if (headerError) {
    return {
      rows: [],
      errors: [],
      totalRows: 0,
      headerError,
    };
  }
  return { rows, errors, totalRows };
}

// ─── shared ──────────────────────────────────────────────────────────────

/**
 * Itera la primera hoja del workbook en streaming. `record` viene con keys
 * ya normalizados (lowercase, sin acentos). Ignora filas totalmente vacías.
 */
/**
 * Lee la PRIMERA hoja del workbook. Usa el reader NO-streaming porque los
 * archivos de import financiero son chicos (decenas o cientos de filas) y
 * el streaming API expone celdas con un shape (model plain object) donde
 * `cell.value` puede venir como objeto sin `.text/.result/.richText` — cosa
 * que rompe la extracción de headers y hace ver "[object Object]" en el UI.
 *
 * El reader no-streaming devuelve `Cell` instances con `.text` accessor, que
 * es la forma canónica y robusta de obtener el string de display de una celda
 * independientemente del tipo underlying (sharedString, formula, richText).
 */
async function readSheet(
  buffer: Buffer,
  onHeaders: (headers: string[]) => void,
  onRow: (record: Record<string, unknown>, rowNumber: number) => void,
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.read(toReadable(buffer));

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    onHeaders([]);
    return;
  }

  let headers: string[] | null = null;
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (headers === null) {
      const extracted = extractHeaders(row);
      if (extracted.length === 0) return;
      headers = extracted;
      onHeaders(headers);
      return;
    }
    const record = rowToRecord(row, headers);
    if (isEmpty(record)) return;
    onRow(record, rowNumber);
  });

  if (headers === null) {
    onHeaders([]);
  }
}

function extractHeaders(row: ExcelJS.Row): string[] {
  const headers: string[] = [];
  row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const text = cellText(cell);
    headers[colNumber - 1] = text ? normalizeName(text) : `__col_${colNumber}`;
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
 * Devuelve el string de display de una celda. Usa `cell.text` (siempre string
 * en el reader no-streaming) con fallback al value plano por si en algún caso
 * borde el accessor devuelve algo raro.
 */
function cellText(cell: ExcelJS.Cell): string {
  const t = (cell as unknown as { text?: unknown }).text;
  if (typeof t === "string") return t.trim();
  // Fallback: mirar .value crudo y coaccionar a string.
  const v = rawCell(cell);
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString();
  return "";
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
    // Excel serializa fechas como serial number → ExcelJS entrega un Date a
    // UTC midnight. Si usamos métodos de local time, un cliente en AR (UTC-3)
    // ve "2026-08-01" como 30/07 21:00 local → getDate() devuelve 30 y la
    // fecha se corre UN DÍA atrás. UTC methods preservan el YMD original.
    return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
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

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function toReadable(buffer: Buffer): Readable {
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);
  return stream;
}
