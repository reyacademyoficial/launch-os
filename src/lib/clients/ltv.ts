/**
 * LTV (Lifetime Value) de un cliente gestionado — Bloque 3 · Kingrow.
 *
 * REGLA DE ORO: LTV es la SUMA de ingresos REALIZADOS que Kingrow ganó
 * gracias a este project a lo largo de toda la relación. Criterio PERCIBIDO
 * (mismo que finance/revenue.ts): solo cuenta lo efectivamente cobrado.
 * Los pipelines (propuesta/confirmada/facturada) NO cuentan hasta que la
 * plata está en la caja.
 *
 * FÓRMULA
 *
 *   LTV(project) =
 *       Σ launch_settlements.kingrow_retained   where status ∈ {liquidada, transferida}
 *     + Σ (invoices.amount_gross − invoices.tax_amount)   where status = 'cobrada'
 *     + Σ renewals.amount   where status = 'cobrada'
 *     + Σ upsells.amount    where status = 'cobrada'
 *
 * WHY ESTOS CUATRO TÉRMINOS
 *   - settlements: margen operativo Kingrow del launch (0055).
 *   - invoices: fees separados (retainer, honorarios) al externo (0064).
 *   - renewals: contrato periódico de gestión Kingrow→cliente (0083).
 *   - upsells: venta adicional cerrada sobre el mismo cliente (0084).
 *
 * NO confundir con `client_transfers` (0056), que es plata que Kingrow
 * DEVUELVE al externo del split — dirección opuesta, no es ingreso.
 *
 * SIN FILTRO DE FECHA: el caller pasa TODAS las rows del project. LTV es
 * lifetime — si querés LTV parcial (últimos 12m) filtrá antes. Mismo
 * criterio que finance/kpis.ts (el selector es puro y no decide período).
 *
 * IVA: invoices vienen brutas (amount_gross incluye IVA). El IVA no es
 * ingreso propio (se remite al fisco). Usamos NETO — misma convención que
 * finance/revenue.ts.
 *
 * // REVISAR CON CONTADOR: si la org opera Monotributo, "ingreso neto" puede
 * definirse distinto. Ajustable filtrando antes o cambiando este selector.
 */

import type {
  ClientsInvoiceRow,
  ClientsSettlementRow,
  RenewalRow,
  UpsellRow,
} from "./types";

export interface LtvInputs {
  /** Todas las liquidaciones del project (cualquier status; el selector filtra). */
  settlements: ClientsSettlementRow[];
  /** Facturas atribuidas al project (cualquier status; el selector filtra). */
  invoices: ClientsInvoiceRow[];
  /** Renewals del project (cualquier status; el selector filtra). */
  renewals: RenewalRow[];
  /** Upsells del project (cualquier status; el selector filtra). */
  upsells: UpsellRow[];
}

export interface LtvBreakdown {
  fromSettlements: number;
  fromInvoices: number;
  fromRenewals: number;
  fromUpsells: number;
  /** Suma de los cuatro. Es el LTV del cliente. */
  total: number;
}

function isSettlementIncome(s: ClientsSettlementRow): boolean {
  return s.status === "liquidada" || s.status === "transferida";
}

function isInvoiceIncome(i: ClientsInvoiceRow): boolean {
  // project_id=null son facturas corporativas sin atribución a un cliente
  // puntual — no cuentan en LTV de un project específico.
  return i.status === "cobrada" && i.project_id !== null;
}

export function computeLtv(inputs: LtvInputs): LtvBreakdown {
  const fromSettlements = inputs.settlements
    .filter(isSettlementIncome)
    .reduce((acc, s) => acc + s.kingrow_retained, 0);

  const fromInvoices = inputs.invoices
    .filter(isInvoiceIncome)
    .reduce((acc, i) => acc + (i.amount_gross - i.tax_amount), 0);

  const fromRenewals = inputs.renewals
    .filter((r) => r.status === "cobrada")
    .reduce((acc, r) => acc + r.amount, 0);

  const fromUpsells = inputs.upsells
    .filter((u) => u.status === "cobrada")
    .reduce((acc, u) => acc + u.amount, 0);

  return {
    fromSettlements,
    fromInvoices,
    fromRenewals,
    fromUpsells,
    total: fromSettlements + fromInvoices + fromRenewals + fromUpsells,
  };
}
