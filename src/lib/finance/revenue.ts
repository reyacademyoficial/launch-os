/**
 * Selector de INGRESOS de Kingrow — función pura, sin acceso a DB.
 *
 * REGLA DE ORO acordada con el usuario:
 * El ingreso de Kingrow NO vive en una tabla de "ventas" propia. Se DERIVA
 * de lo que Kingrow retiene en cada liquidación de lanzamiento
 * (`launch_settlements.kingrow_retained`) MÁS lo que Kingrow factura por
 * fees separados a clientes externos (`invoices`).
 *
 * QUÉ CUENTA COMO INGRESO REALIZADO
 *
 *   - `launch_settlements` con status ∈ {liquidada, transferida}.
 *     La status `abierta` es un BORRADOR (aún no confirmado); NO se cuenta.
 *   - `invoices` con status='cobrada' (implica paid_at != null por el CHECK
 *     invoices_paid_at_matches_status de 0064).
 *   - `otherIncome` — hueco para líneas ad-hoc que el caller pase
 *     manualmente (dividendos, extras).
 *
 * // REVISAR CON CONTADOR: usamos criterio PERCIBIDO — solo cuenta lo
 * efectivamente cobrado (liquidaciones cerradas, facturas cobradas). Bajo
 * criterio DEVENGADO habría que sumar también invoices `emitida`/`vencida`
 * como ingreso del período de emisión. El usuario/contador puede pedir
 * cambiar el filtro; hoy va PERCIBIDO como acordado en la conversación.
 *
 * IVA / IMPUESTOS EN INVOICES
 *
 * `amount_gross` incluye IVA. IVA débito no es ingreso propio (se remite al
 * fisco), por eso usamos NETO = `amount_gross − tax_amount`. Es la
 * convención estándar de estado de resultados.
 * // REVISAR CON CONTADOR — si la org opera bajo Monotributo o algún
 * régimen simplificado, el criterio de "ingreso neto" puede diferir.
 *
 * FILTRO DE PERÍODO
 *
 * Esta función NO filtra por fecha. El CALLER hace la query SQL con el
 * rango del período y pasa las rows ya filtradas. Mantiene el selector puro
 * y testeable — mismo patrón que `calculateLaunchKPIs` en `src/lib/kpis.ts`.
 */

import type {
  FinanceInvoiceRow,
  FinanceLaunchSettlementRow,
} from "./types";

export interface RevenueInputs {
  /** Liquidaciones del período — cualquier status, el selector filtra. */
  settlements: FinanceLaunchSettlementRow[];
  /** Facturas del período — cualquier status, el selector filtra. */
  invoices: FinanceInvoiceRow[];
  /** Líneas manuales de ingreso ad-hoc (default 0). */
  otherIncome?: number;
}

export interface RevenueBreakdown {
  /** Σ kingrow_retained de liquidaciones liquidadas + transferidas. */
  revenueFromSettlements: number;
  /** Σ (amount_gross − tax_amount) de invoices cobradas. */
  revenueFromInvoices: number;
  /** Pasado por el caller sin transformar. */
  otherIncome: number;
  /** Suma de los tres. Es el ingreso total del período. */
  revenueTotal: number;
}

function isSettlementIncome(s: FinanceLaunchSettlementRow): boolean {
  return s.status === "liquidada" || s.status === "transferida";
}

function isInvoiceIncome(i: FinanceInvoiceRow): boolean {
  return i.status === "cobrada";
}

export function computeRevenue(inputs: RevenueInputs): RevenueBreakdown {
  const revenueFromSettlements = inputs.settlements
    .filter(isSettlementIncome)
    .reduce((acc, s) => acc + s.kingrow_retained, 0);

  const revenueFromInvoices = inputs.invoices
    .filter(isInvoiceIncome)
    .reduce((acc, i) => acc + (i.amount_gross - i.tax_amount), 0);

  const otherIncome = inputs.otherIncome ?? 0;

  return {
    revenueFromSettlements,
    revenueFromInvoices,
    otherIncome,
    revenueTotal: revenueFromSettlements + revenueFromInvoices + otherIncome,
  };
}
