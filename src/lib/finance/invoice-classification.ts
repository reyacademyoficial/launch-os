/**
 * Clasificación de facturas — regla de negocio en UN solo lugar.
 *
 * Regla de negocio (cerrada con administración de Kingrow):
 *
 *   · Empresas PROPIAS: la plata que cobran en el día a día es ingreso
 *     inmediato de Kingrow. No se espera a liquidar el lanzamiento.
 *     TODA factura cobrada de un proyecto propio cuenta como ingreso,
 *     tenga o no `launch_id`. El equipo administrativo trabaja con ese
 *     flujo — verlo recién al cierre distorsiona la caja del mes.
 *
 *   · Empresas EXTERNAS: el ingreso de Kingrow se reconoce al cerrar la
 *     liquidación (kingrow_retained), no al cobrar la factura del cliente.
 *     Las facturas del launch son plata del cliente externo, no de Kingrow
 *     — se muestran como volumen del grupo (contexto), no como ingreso.
 *     Las facturas sueltas (sin launch) también son ajenas.
 *
 * Toda factura cae en exactamente una de estas tres categorías:
 *
 *   ┌─ project_id == null                       → 'third-party'
 *   │    (defecto de carga; ver nota abajo)
 *   │
 *   ├─ ownership = 'propia'                     → 'kingrow-income'
 *   │    (con o sin launch_id — política percibido para propias)
 *   │
 *   ├─ ownership ≠ 'propia' && launch_id != null → 'group-volume'
 *   │    (plata que gestiona una externa por su lanzamiento; el ingreso
 *   │     de Kingrow sobre ese launch aparece al liquidar)
 *   │
 *   └─ ownership ≠ 'propia' && launch_id == null → 'third-party'
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
 * DOBLE CONTEO — obligación del caller
 *   Si las invoices de una launch propia ya suman al ingreso, la
 *   liquidación de ese mismo launch NO puede sumar de nuevo. El caller
 *   filtra `launch_settlements` a solo las de projects externos antes de
 *   pasar a `computeRevenue`. Enforce por convención — el selector no
 *   conoce ownership de settlement.
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
  if (invoice.project_id == null) return "third-party";
  if (ownership === "propia") return "kingrow-income";
  return invoice.launch_id != null ? "group-volume" : "third-party";
}
