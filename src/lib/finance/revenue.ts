/**
 * Selector de INGRESOS de Kingrow — función pura, sin acceso a DB.
 *
 * REGLA DE NEGOCIO (cerrada con administración):
 *
 *   · Propias (Rey Academy, Growins, Kingrow): criterio PERCIBIDO. Toda
 *     factura cobrada del proyecto es ingreso inmediato, con o sin launch.
 *     La caja del día a día refleja lo que administración usa para operar.
 *   · Externas (clientes gestionados): ingreso = kingrow_retained al cerrar
 *     la liquidación. Las facturas del launch son volumen del cliente
 *     externo, no ingreso propio.
 *
 * QUÉ CUENTA COMO INGRESO REALIZADO
 *
 *   - `launch_settlements` con status ∈ {liquidada, transferida}, PERO
 *     solo las de projects externos. El caller filtra las de propias
 *     antes de pasarlas — sino se contaría dos veces con las invoices.
 *     La status `abierta` es BORRADOR y no se cuenta.
 *   - `invoices` con status='cobrada' clasificadas como 'kingrow-income'.
 *     Con la nueva regla, toda invoice cobrada de un project propio cae
 *     acá (con o sin launch_id). Las 'group-volume' y 'third-party' NO
 *     entran al ingreso, se devuelven por separado como contexto.
 *   - `otherIncome` — hueco para líneas ad-hoc que el caller pase
 *     manualmente (dividendos, extras).
 *
 * DOBLE CONTEO — obligación del caller
 *
 *   Si una factura de un launch propio cobrada suma como kingrow-income, la
 *   liquidación posterior de ese mismo launch NO puede sumar de nuevo. Por
 *   eso el caller descarta settlements de projects propias antes de pasar.
 *   El selector no sabe ownership de settlement — el enforce vive arriba.
 *
 * IVA / IMPUESTOS EN INVOICES
 *
 * `amount_gross` incluye IVA. IVA débito no es ingreso propio (se remite al
 * fisco), por eso usamos NETO = `amount_gross − tax_amount`. Convención
 * estándar de estado de resultados.
 *
 * FILTRO DE PERÍODO
 *
 * Esta función NO filtra por fecha. El CALLER hace la query SQL con el
 * rango del período y pasa las rows ya filtradas. Mantiene el selector puro
 * y testeable — mismo patrón que `calculateLaunchKPIs` en `src/lib/kpis.ts`.
 */

import {
  classifyInvoice,
  type Ownership,
} from "./invoice-classification";
import type {
  FinanceInvoiceRow,
  FinanceLaunchSettlementRow,
} from "./types";

/**
 * Resolver ownership. El caller arma un `Map<projectId, Ownership>` una
 * sola vez (fuera del hot loop del sparkline) y expone esta función.
 * Devolver `null` para proyectos que no pudo resolver — el clasificador
 * los trata como third-party por seguridad (nunca inflar el ingreso).
 */
export type OwnershipResolver = (projectId: string | null) => Ownership;

export interface RevenueInputs {
  /** Liquidaciones del período — el selector filtra por status. */
  settlements: FinanceLaunchSettlementRow[];
  /** Facturas del período — el selector filtra por status Y por clasificación. */
  invoices: FinanceInvoiceRow[];
  /**
   * Resuelve ownership por project_id. El caller lo arma UNA vez para
   * todos los buckets del sparkline; no repetir por período.
   */
  resolveOwnership: OwnershipResolver;
  /** Líneas manuales de ingreso ad-hoc (default 0). */
  otherIncome?: number;
}

export interface RevenueBreakdown {
  // ─── Sí suman al total ─────────────────────────────────────────────
  /** Σ kingrow_retained de liquidaciones liquidadas + transferidas. */
  revenueFromSettlements: number;
  /**
   * Σ (amount_gross − tax_amount) de invoices cobradas clasificadas como
   * 'kingrow-income' — ventas sueltas / retainers de empresas propias
   * que ninguna liquidación captura.
   */
  revenueFromDirectSales: number;
  /** Pasado por el caller sin transformar. */
  otherIncome: number;
  /** Suma de los tres. Es el ingreso de Kingrow del período. */
  revenueTotal: number;

  // ─── NO suman al total, se exponen como contexto ───────────────────
  /**
   * Σ neto de invoices cobradas 'group-volume' (facturas de un lanzamiento).
   * Ya está en la liquidación — sumarlo sería doble conteo. Informativo.
   */
  groupVolumeFromInvoices: number;
  /**
   * Σ neto de invoices cobradas 'third-party' (proyectos externos sin
   * lanzamiento, o defectos de carga sin project_id). Plata ajena que
   * Kingrow eventualmente procesa pero no es su ingreso. Informativo.
   */
  thirdPartyFromInvoices: number;
}

function isSettlementIncome(s: FinanceLaunchSettlementRow): boolean {
  return s.status === "liquidada" || s.status === "transferida";
}

function isInvoiceIncome(i: FinanceInvoiceRow): boolean {
  return i.status === "cobrada";
}

function invoiceNet(i: FinanceInvoiceRow): number {
  return i.amount_gross - i.tax_amount;
}

export function computeRevenue(inputs: RevenueInputs): RevenueBreakdown {
  const revenueFromSettlements = inputs.settlements
    .filter(isSettlementIncome)
    .reduce((acc, s) => acc + s.kingrow_retained, 0);

  let revenueFromDirectSales = 0;
  let groupVolumeFromInvoices = 0;
  let thirdPartyFromInvoices = 0;

  for (const i of inputs.invoices) {
    if (!isInvoiceIncome(i)) continue;
    const net = invoiceNet(i);
    const cls = classifyInvoice(i, inputs.resolveOwnership(i.project_id));
    switch (cls) {
      case "kingrow-income":
        revenueFromDirectSales += net;
        break;
      case "group-volume":
        groupVolumeFromInvoices += net;
        break;
      case "third-party":
        thirdPartyFromInvoices += net;
        break;
    }
  }

  const otherIncome = inputs.otherIncome ?? 0;

  return {
    revenueFromSettlements,
    revenueFromDirectSales,
    otherIncome,
    revenueTotal: revenueFromSettlements + revenueFromDirectSales + otherIncome,
    groupVolumeFromInvoices,
    thirdPartyFromInvoices,
  };
}
