/**
 * Clasificación de facturas — regla de negocio en UN solo lugar.
 *
 * Definición cerrada con el dueño de Kingrow: la liquidación mide cuánto
 * GANÓ Kingrow, la factura mide cuánto VENDIÓ una operativa. Son magnitudes
 * distintas y no se suman nunca. Toda factura cae en exactamente una de
 * estas tres categorías:
 *
 *   ┌─ launch_id != null                       → 'group-volume'
 *   │    (ya está en la liquidación; sumarla al ingreso sería doble conteo
 *   │     si el proyecto es propio, o mezclar plata ajena si es externo)
 *   │
 *   ├─ launch_id == null && ownership='propia' → 'kingrow-income'
 *   │    (venta suelta / retainer / consultoría de una empresa propia:
 *   │     ninguna liquidación la captura, es ingreso real de Kingrow)
 *   │
 *   └─ launch_id == null && ownership≠'propia' → 'third-party'
 *        (venta suelta de un cliente externo; visible pero fuera del
 *         ingreso de Kingrow)
 *
 * DEFECTO DE CARGA — project_id NULL
 *   Kingrow no emite facturas: las emiten las operativas, y toda operativa
 *   es un proyecto. Una factura sin project_id es un dato incompleto, no
 *   una categoría legítima. Acá lo tratamos como 'third-party' (para que
 *   no contamine el ingreso), pero el caller lo cuenta aparte en el
 *   indicador de calidad de dato.
 *
 * PUREZA
 *   La resolución de ownership se pasa como parámetro. El clasificador no
 *   toca DB. Mismo patrón que el resto de `src/lib/finance/` — el caller
 *   arma el mapa `projectId → ownership` una sola vez y lo pasa.
 */

import type { FinanceInvoiceRow } from "./types";

export type InvoiceClass = "kingrow-income" | "group-volume" | "third-party";

/** Ownership relevante para la clasificación. `null` = proyecto desconocido. */
export type Ownership = "propia" | "externa" | null;

export function classifyInvoice(
  invoice: Pick<FinanceInvoiceRow, "project_id" | "launch_id">,
  ownership: Ownership,
): InvoiceClass {
  if (invoice.launch_id != null) return "group-volume";
  if (invoice.project_id == null) return "third-party";
  return ownership === "propia" ? "kingrow-income" : "third-party";
}
