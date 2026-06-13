import "server-only";

import type { LeadRow } from "./types";

/**
 * Serializa leads a CSV (RFC 4180) para descarga directa.
 *
 * Reglas:
 *   - Separador `,`. Newline `\r\n` (Windows + Excel-friendly).
 *   - Cualquier valor con `,`, `"`, `\n` o `\r` va entre comillas. Las comillas
 *     internas se duplican (`"a""b"`).
 *   - Headers en la primera línea, en castellano y en el mismo orden que el
 *     xlsx (`buildLeadsWorkbook` en `./export.ts`) — para que los dos formatos
 *     sean intercambiables.
 *   - Prepend BOM `﻿` para que Excel detecte UTF-8 y los acentos / ñ
 *     rendereen correctos. Sheets ignora el BOM. Notepad++ lo muestra como
 *     marker, pero abre OK.
 *
 * Salida: string. El route handler lo manda con
 * `Content-Type: text/csv; charset=utf-8`. El tamaño máximo no se controla acá
 * — el cap está en `listLeadsForExport` (50k filas).
 */

const HEADERS = [
  "Nombre",
  "Telefono",
  "Email",
  "Contacto",
  "Origen",
  "Estado",
  "Cargado",
  "En kanban",
] as const;

export function buildLeadsCsv(rows: ReadonlyArray<LeadRow>): string {
  const lines: string[] = [];
  lines.push(HEADERS.map(csvField).join(","));

  for (const lead of rows) {
    lines.push(
      [
        lead.name,
        lead.phone_normalized ?? "",
        lead.email ?? "",
        lead.contact ?? "",
        lead.source,
        lead.status,
        new Date(lead.created_at).toISOString().slice(0, 10),
        lead.pinned_to_kanban ? "sí" : "no",
      ]
        .map(csvField)
        .join(","),
    );
  }

  // BOM para que Excel detecte UTF-8 (sin esto los acentos salen como caracteres
  // de control). `\r\n` para que el archivo abra prolijo en notebooks de
  // Windows también.
  return `﻿${lines.join("\r\n")}\r\n`;
}

/**
 * Escapado RFC 4180. Sólo se mete entre comillas cuando hace falta; los
 * valores "limpios" pasan sin transformar (más legibles si alguien lee el CSV
 * a ojo).
 */
function csvField(value: string): string {
  if (value === "") return "";
  const needsQuoting =
    value.includes(",") ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r");
  if (!needsQuoting) return value;
  return `"${value.replace(/"/g, '""')}"`;
}
