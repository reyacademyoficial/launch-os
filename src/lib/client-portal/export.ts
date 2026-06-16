import "server-only";

import ExcelJS from "exceljs";

import type { ClientLeadRow } from "./types";

/**
 * Export de leads del cliente — CSV + XLSX con shape de `ClientLeadRow`.
 *
 * Misma forma de salida que `lib/leads/export-csv.ts` y `lib/leads/export.ts`
 * (mismos headers, mismo BOM UTF-8, mismo orden de columnas), pero typed
 * contra el subset safe. Mantenemos los archivos separados para que el
 * builder del equipo no pida `team_member_id` (que el cliente no puede leer)
 * por error tras un cambio de schema.
 */

const CSV_HEADERS = [
  "Nombre",
  "Telefono",
  "Email",
  "Contacto",
  "Origen",
  "Estado",
  "Cargado",
] as const;

export function buildClientLeadsCsv(rows: ReadonlyArray<ClientLeadRow>): string {
  const lines: string[] = [];
  lines.push(CSV_HEADERS.map(csvField).join(","));

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
      ]
        .map(csvField)
        .join(","),
    );
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}

export async function buildClientLeadsWorkbook(
  rows: ReadonlyArray<ClientLeadRow>,
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Launch OS";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Leads");
  sheet.columns = [
    { header: "Nombre", key: "name", width: 28 },
    { header: "Telefono", key: "phone", width: 20 },
    { header: "Email", key: "email", width: 28 },
    { header: "Contacto", key: "contact", width: 20 },
    { header: "Origen", key: "source", width: 12 },
    { header: "Estado", key: "status", width: 14 },
    { header: "Cargado", key: "created_at", width: 20 },
  ];

  for (const lead of rows) {
    sheet.addRow({
      name: lead.name,
      phone: lead.phone_normalized ?? "",
      email: lead.email ?? "",
      contact: lead.contact ?? "",
      source: lead.source,
      status: lead.status,
      created_at: new Date(lead.created_at).toISOString().slice(0, 10),
    });
  }

  sheet.getRow(1).font = { bold: true };
  const buf = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buf);
}

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
