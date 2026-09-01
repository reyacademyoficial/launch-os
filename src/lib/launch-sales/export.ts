import "server-only";

import ExcelJS from "exceljs";

import type {
  ExportCollectionStatus,
  ExportCurrency,
  SaleExportRow,
  SalesExportMeta,
} from "./export-types";

/**
 * Export xlsx de la tabla de Ventas project-wide (`/proyectos/[id]/ventas`).
 *
 * A diferencia de los exports del módulo financiero —que releen la DB en el
 * route handler— acá las filas viajan **desde el cliente**. El motivo es que
 * los filtros de esa tabla (query, launch, closer, producto, método, estado de
 * cobro) viven en React state, no en la URL, y las columnas derivadas
 * (comisión por tier + ranking, cobrado FX-aware, método agregado) ya están
 * calculadas en `ProjectSalesView`. Rehacer todo eso en el server duplicaría
 * ~200 líneas de wiring y garantizaría drift entre lo que el usuario ve y lo
 * que baja. El route valida permisos sobre el proyecto igual que el resto de
 * los exports; el payload solo puede producir un archivo que el propio usuario
 * se descarga, no se persiste nada.
 *
 * Convenciones (mismas que `lib/finance/xlsx-export.ts`):
 *   - Montos como Number con numFmt por columna — no strings pre-formateados,
 *     así el usuario puede pivotear/sumar en Excel.
 *   - Cada monto lleva su columna de moneda al lado: el proyecto opera ARS y
 *     USD en la misma tabla y sumarlos sin distinguir es el bug clásico.
 *   - Fechas como Date para que Excel las reconozca según el locale.
 */

export type { ExportCollectionStatus, ExportCurrency, SaleExportRow, SalesExportMeta };

const MONEY_STYLE = { numFmt: "#,##0.00" } as const;
const DATE_STYLE = { numFmt: "dd/mm/yyyy" } as const;

const STATUS_LABELS: Record<ExportCollectionStatus, string> = {
  paid: "Cobrada",
  partial: "Parcial",
  unpaid: "Sin cobrar",
};

export async function buildProjectSalesWorkbook(
  rows: ReadonlyArray<SaleExportRow>,
  meta: SalesExportMeta,
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Launch OS";
  workbook.created = new Date();

  buildSalesSheet(workbook, rows, meta);
  buildSummarySheet(workbook, rows, meta);

  const buf = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buf);
}

// ─── Hoja "Ventas" ─────────────────────────────────────────────────────────

function buildSalesSheet(
  workbook: ExcelJS.Workbook,
  rows: ReadonlyArray<SaleExportRow>,
  meta: SalesExportMeta,
): void {
  const sheet = workbook.addWorksheet("Ventas");

  // Las columnas de comisión se arman aparte para poder sacarlas enteras
  // cuando `hideCommission` — igual que la tabla, que no renderiza el th.
  const commissionColumns: Partial<ExcelJS.Column>[] = meta.hideCommission
    ? []
    : [
        { header: "Comisión", key: "commission", width: 16, style: MONEY_STYLE },
        { header: "Moneda comisión", key: "commissionCurrency", width: 16 },
      ];

  sheet.columns = [
    { header: "Alumno", key: "student", width: 28 },
    { header: "Email", key: "email", width: 28 },
    { header: "Teléfono", key: "phone", width: 18 },
    { header: "Contacto", key: "contact", width: 28 },
    { header: "Producto", key: "product", width: 26 },
    { header: "Lanzamiento", key: "launch", width: 24 },
    { header: "Vendedor", key: "seller", width: 22 },
    { header: "Método", key: "method", width: 24 },
    { header: "Moneda", key: "currency", width: 9 },
    { header: "Monto pactado", key: "pledged", width: 16, style: MONEY_STYLE },
    { header: "Monto cobrado", key: "collected", width: 16, style: MONEY_STYLE },
    { header: "Moneda cobrado", key: "collectedCurrency", width: 15 },
    ...commissionColumns,
    { header: "Estado de cobro", key: "status", width: 15 },
    { header: "Pactado (USD)", key: "pledgedUsd", width: 15, style: MONEY_STYLE },
    { header: "Cobrado (USD)", key: "collectedUsd", width: 15, style: MONEY_STYLE },
    { header: "Cobros", key: "paymentCount", width: 9 },
    { header: "Cuotas", key: "installmentCount", width: 9 },
    { header: "Cierre", key: "closedAt", width: 12, style: DATE_STYLE },
  ];

  for (const r of rows) {
    const added = sheet.addRow({
      student: r.student,
      email: r.email,
      phone: r.phone,
      contact: r.contact,
      product: r.product,
      launch: r.launch,
      seller: r.seller,
      method: r.method,
      currency: r.currency,
      pledged: r.pledged,
      collected: r.collected,
      collectedCurrency: r.collectedCurrency,
      ...(meta.hideCommission
        ? {}
        : {
            commission: r.commission,
            commissionCurrency: r.commissionCurrency,
          }),
      status: STATUS_LABELS[r.status],
      // "" en vez de 0 cuando falta tasa: un 0 se sumaría en el pivot y
      // mentiría sobre el revenue.
      pledgedUsd: r.pledgedUsd ?? "",
      collectedUsd: r.collectedUsd ?? "",
      paymentCount: r.paymentCount,
      installmentCount: r.installmentCount,
      closedAt: isoToDate(r.closedAt),
    });

    // Mismo warning que la celda "moneda distinta" de la tabla: sin esto el
    // cobrado y el pactado quedan en unidades distintas sin que se note.
    if (r.mixedCurrency) {
      added.getCell("collectedCurrency").note =
        "Los cobros de esta venta están en moneda distinta al pactado. El monto cobrado se muestra convertido a USD.";
    }
  }

  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: "middle" };
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  if (rows.length > 0) {
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: rows.length + 1, column: sheet.columnCount },
    };
  }
}

// ─── Hoja "Resumen" ────────────────────────────────────────────────────────

/**
 * Espeja el tfoot de la tabla: totales en USD para pactado/cobrado (única
 * unidad común) y comisión acumulada **por moneda**, sin convertir — decisión
 * explícita del producto, los tiers fixed tienen su propia moneda.
 */
function buildSummarySheet(
  workbook: ExcelJS.Workbook,
  rows: ReadonlyArray<SaleExportRow>,
  meta: SalesExportMeta,
): void {
  const sheet = workbook.addWorksheet("Resumen");
  sheet.columns = [
    { header: "", key: "label", width: 34 },
    { header: "", key: "value", width: 22 },
  ];

  let pledgedUsd = 0;
  let collectedUsd = 0;
  let commissionArs = 0;
  let commissionUsd = 0;
  let missingFx = 0;
  for (const r of rows) {
    if (r.pledgedUsd === null) missingFx += 1;
    else pledgedUsd += r.pledgedUsd;
    if (r.collectedUsd !== null) collectedUsd += r.collectedUsd;
    if (r.commissionCurrency === "USD") commissionUsd += r.commission;
    else commissionArs += r.commission;
  }

  const money = (n: number) => ({ value: n, numFmt: "#,##0.00" });

  addPair(sheet, "Ventas exportadas", rows.length);
  addPair(sheet, "Total pactado (USD)", money(pledgedUsd));
  addPair(sheet, "Total cobrado (USD)", money(collectedUsd));
  if (!meta.hideCommission) {
    addPair(sheet, "Total comisión (ARS)", money(commissionArs));
    addPair(sheet, "Total comisión (USD)", money(commissionUsd));
  }
  if (missingFx > 0) {
    addPair(sheet, "Ventas sin tasa FX (excluidas del total USD)", missingFx);
  }

  sheet.addRow({});
  const filtersHeader = sheet.addRow({ label: "Filtros aplicados" });
  filtersHeader.font = { bold: true };
  if (meta.filters.length === 0) {
    sheet.addRow({ label: "Ninguno — todas las ventas del proyecto" });
  } else {
    for (const f of meta.filters) sheet.addRow({ label: f });
  }

  sheet.addRow({});
  sheet
    .addRow({
      label: "Generado",
      value: new Date(),
    })
    .getCell("value").numFmt = "dd/mm/yyyy hh:mm";
  if (meta.projectName) addPair(sheet, "Proyecto", meta.projectName);
}

function addPair(
  sheet: ExcelJS.Worksheet,
  label: string,
  value: string | number | { value: number; numFmt: string },
): void {
  const row = sheet.addRow({
    label,
    value: typeof value === "object" ? value.value : value,
  });
  row.getCell("label").font = { bold: true };
  if (typeof value === "object") row.getCell("value").numFmt = value.numFmt;
}

/** ISO timestamptz → Date; si no parsea, devuelve el string crudo. */
function isoToDate(iso: string): Date | string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d;
}
