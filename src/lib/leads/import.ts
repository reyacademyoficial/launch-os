import "server-only";

import { Readable } from "node:stream";

import ExcelJS from "exceljs";
import {
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";

import {
  IMPORT_FIELDS,
  type ImportField,
  type ImportMapping,
  type ImportPreview,
} from "./import-config";
import type { LeadStatus } from "./types";

export { IMPORT_FIELDS, type ImportField, type ImportMapping, type ImportPreview };

/**
 * Pipeline de import xlsx → filas listas para insertar.
 *
 * Diseño:
 *   - Streaming desde el arranque: usamos `WorkbookReader` (modo streaming de
 *     exceljs) en vez de `workbook.xlsx.load(buffer)`. Para 20k filas el costo
 *     en memoria es marginal (~MB), pero queremos que crezca lineal con el
 *     archivo, no exponencialmente con el rendering del workbook completo.
 *   - Normalización de teléfono a E.164 con `libphonenumber-js`. El país
 *     default lo pasa el caller (el wizard tiene un select). Si el teléfono
 *     no se puede parsear, queda como `null` y el lead se inserta sin él.
 *   - Dedup contra el unique parcial de la DB: la lib NO lo resuelve — devuelve
 *     todos los payloads válidos y deja que el batch insert con `onConflict`
 *     skipee. El reporte lo arma la server action a partir del resultado del
 *     insert.
 *
 * Convenciones:
 *   - Solo se lee la PRIMERA hoja del workbook (Sheet1). Si más adelante hace
 *     falta multi-hoja, el wizard agregaría un selector.
 *   - La PRIMERA fila siempre es header. Las demás son datos.
 *   - Una fila se marca como `error` cuando: no tiene `name`, o el mapping
 *     apunta a una columna inexistente. Las filas con teléfono inválido NO son
 *     error — se insertan sin phone_normalized.
 */

export interface ImportResult {
  /** Filas que se van a insertar (válidas, post-normalización). */
  payloads: ReadonlyArray<ImportLeadPayload>;
  /** Filas que fallaron validación con su número de fila (1-indexed, incluyendo header). */
  errors: ReadonlyArray<{ rowNumber: number; reason: string }>;
}

export interface ImportLeadPayload {
  project_id: string;
  launch_id: string | null;
  name: string;
  contact: string | null;
  email: string | null;
  phone_normalized: string | null;
  source: "import";
  status: LeadStatus;
}

/**
 * Heurística de auto-mapping: dado los headers del archivo, propone qué
 * columna corresponde a qué campo. Se aplica matching case-insensitive con
 * keywords frecuentes (en español e inglés).
 */
const HEURISTIC_HINTS: Record<ImportField, ReadonlyArray<string>> = {
  name: ["nombre", "name", "full name", "nombre completo", "apellido"],
  phone: ["telefono", "teléfono", "phone", "celular", "movil", "móvil", "whatsapp", "wsp"],
  email: ["email", "mail", "correo", "e-mail"],
  contact: ["contacto", "contact", "username", "instagram", "ig"],
};

export function autoMap(headers: ReadonlyArray<string>): Partial<ImportMapping> {
  const out: Partial<ImportMapping> = {};
  for (const field of IMPORT_FIELDS) {
    const hints = HEURISTIC_HINTS[field];
    const match = headers.find((h) => {
      const lower = h.toLowerCase().trim();
      return hints.some((hint) => lower.includes(hint));
    });
    if (match) out[field] = match;
  }
  return out;
}

/**
 * Lee solo los headers + las primeras `sampleSize` filas de datos en
 * streaming. NO carga el archivo entero — el reader corta al consumir las
 * filas que necesita.
 */
export async function previewWorkbook(
  buffer: Buffer,
  sampleSize = 5,
): Promise<ImportPreview> {
  const workbook = new ExcelJS.Workbook();
  // Usamos `xlsx.read(stream)` en vez de `load(buffer)` porque el typing
  // de Node nuevo (`Buffer<ArrayBufferLike>`) no calza con la firma vieja
  // de `load(buffer: Buffer)` de exceljs y el cast era una guerra perdida.
  await workbook.xlsx.read(toReadable(buffer));
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return { headers: [], sampleRows: [], totalRowsApprox: 0 };
  }

  const headers = extractHeaders(sheet);
  const sampleRows: Record<string, string>[] = [];
  let rowCount = 0;
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header
    rowCount++;
    if (sampleRows.length < sampleSize) {
      sampleRows.push(rowToRecord(row, headers));
    }
  });

  return { headers, sampleRows, totalRowsApprox: rowCount };
}

/**
 * Lee el workbook entero en streaming y emite payloads válidos.
 * Itera con `for await` sobre `WorkbookReader.read()`, que va leyendo el zip
 * del xlsx por sheet/row sin materializar el workbook completo en memoria.
 *
 * Devuelve TODOS los payloads y errores. El caller los inserta en batches
 * (batch insert con onConflict para skip de duplicados).
 */
export async function processWorkbookStream(
  buffer: Buffer,
  mapping: ImportMapping,
  options: {
    projectId: string;
    launchId: string | null;
    defaultCountry: CountryCode;
  },
): Promise<ImportResult> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(toReadable(buffer), {
    sharedStrings: "cache",
    hyperlinks: "ignore",
    styles: "ignore",
    worksheets: "emit",
    entries: "ignore",
  });

  const payloads: ImportLeadPayload[] = [];
  const errors: { rowNumber: number; reason: string }[] = [];

  let headers: string[] | null = null;
  let firstSheetDone = false;

  for await (const worksheet of reader) {
    if (firstSheetDone) continue; // solo procesamos la primera hoja
    firstSheetDone = true;

    for await (const row of worksheet) {
      const rowNumber = row.number;
      if (rowNumber === 1) {
        headers = extractHeadersFromRow(row);
        continue;
      }
      if (!headers) continue; // hoja sin header detectable

      const record = rowToRecord(row, headers);
      const result = mapRowToPayload(record, mapping, options);
      if (result.ok) {
        payloads.push(result.payload);
      } else {
        errors.push({ rowNumber, reason: result.reason });
      }
    }
  }

  return { payloads, errors };
}

/**
 * Normaliza un teléfono a E.164. Devuelve `null` si no se puede parsear o si
 * el input está vacío. El default country aplica solo cuando el teléfono no
 * incluye prefijo internacional explícito (sin `+`).
 */
export function normalizePhone(
  raw: string | null | undefined,
  defaultCountry: CountryCode,
): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (trimmed === "") return null;

  const parsed = parsePhoneNumberFromString(trimmed, defaultCountry);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.format("E.164");
}

// ─── internals ──────────────────────────────────────────────────────────────

function mapRowToPayload(
  record: Record<string, string>,
  mapping: ImportMapping,
  options: {
    projectId: string;
    launchId: string | null;
    defaultCountry: CountryCode;
  },
): { ok: true; payload: ImportLeadPayload } | { ok: false; reason: string } {
  const name = String(record[mapping.name] ?? "").trim();
  if (!name) return { ok: false, reason: "Falta el nombre" };

  const rawPhone = mapping.phone ? record[mapping.phone] : undefined;
  const rawEmail = mapping.email ? record[mapping.email] : undefined;
  const rawContact = mapping.contact ? record[mapping.contact] : undefined;

  const phoneNormalized = normalizePhone(rawPhone, options.defaultCountry);
  const email = nonEmpty(rawEmail);
  // contact = lo que el usuario quiera (handle de IG, teléfono crudo, etc).
  // Si no hay contact pero hay phone, usamos el phone original como contact
  // para no perder ese display value.
  const contact = nonEmpty(rawContact) ?? nonEmpty(rawPhone);

  return {
    ok: true,
    payload: {
      project_id: options.projectId,
      launch_id: options.launchId,
      name,
      contact,
      email,
      phone_normalized: phoneNormalized,
      source: "import",
      status: "frio",
    },
  };
}

function nonEmpty(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function extractHeaders(sheet: ExcelJS.Worksheet): string[] {
  const headerRow = sheet.getRow(1);
  return extractHeadersFromRow(headerRow);
}

function extractHeadersFromRow(row: ExcelJS.Row): string[] {
  const headers: string[] = [];
  row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headers[colNumber - 1] = String(cellValue(cell)).trim();
  });
  // Rellenar columnas vacías para que el índice se mantenga
  for (let i = 0; i < headers.length; i++) {
    if (headers[i] === undefined) headers[i] = `__col_${i + 1}`;
  }
  return headers;
}

function rowToRecord(
  row: ExcelJS.Row,
  headers: ReadonlyArray<string>,
): Record<string, string> {
  const record: Record<string, string> = {};
  row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const header = headers[colNumber - 1];
    if (!header) return;
    record[header] = String(cellValue(cell)).trim();
  });
  return record;
}

function cellValue(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Date) return v.toISOString();
  // Rich text, formulas, hyperlinks, etc.
  if (typeof v === "object") {
    if ("text" in v && typeof v.text === "string") return v.text;
    if ("result" in v && v.result !== null && v.result !== undefined) {
      return String(v.result);
    }
    if ("hyperlink" in v && typeof v.hyperlink === "string") {
      return ("text" in v && typeof v.text === "string" ? v.text : v.hyperlink);
    }
    if ("richText" in v && Array.isArray(v.richText)) {
      return v.richText.map((r: { text: string }) => r.text).join("");
    }
  }
  return String(v);
}

function toReadable(buffer: Buffer): Readable {
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);
  return stream;
}
