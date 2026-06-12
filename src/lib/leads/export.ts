import "server-only";

import ExcelJS from "exceljs";

import type { LeadRow } from "./types";

/**
 * Genera dos tipos de workbook xlsx:
 *   - `buildTemplateWorkbook()`: archivo de muestra con los headers que el
 *     wizard espera + 2 filas de ejemplo. El usuario descarga, lo llena con
 *     su data y lo sube. Garantiza que el auto-mapping va a matchear.
 *   - `buildLeadsWorkbook(rows)`: export de los leads existentes con todos
 *     los campos. Sirve como respaldo / análisis externo y, importante, como
 *     plantilla "viva" si el usuario quiere editar y re-importar.
 *
 * Streaming: ambas funciones devuelven `Uint8Array` (no string ni File). El
 * route handler las pone en un Response con Content-Type xlsx.
 */

const HEADERS = ["Nombre", "Telefono", "Email", "Contacto"] as const;

export async function buildTemplateWorkbook(): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Launch OS";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Leads");
  sheet.columns = HEADERS.map((h) => ({ header: h, key: h, width: 24 }));

  // Filas de ejemplo. El teléfono va con el formato internacional para que
  // el usuario sepa cuál es el target del normalize; el wizard igual normaliza
  // los teléfonos locales del país elegido.
  sheet.addRow({
    Nombre: "Juan Pérez",
    Telefono: "+5491155555555",
    Email: "juan@example.com",
    Contacto: "@juanperez",
  });
  sheet.addRow({
    Nombre: "María García",
    Telefono: "1144556677",
    Email: "maria@example.com",
    Contacto: "",
  });

  // Header en bold para distinguirlo del data range.
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { vertical: "middle" };

  const buf = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buf);
}

export async function buildLeadsWorkbook(
  rows: ReadonlyArray<LeadRow>,
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
    { header: "En kanban", key: "pinned", width: 12 },
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
      pinned: lead.pinned_to_kanban ? "sí" : "no",
    });
  }

  sheet.getRow(1).font = { bold: true };

  const buf = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buf);
}
