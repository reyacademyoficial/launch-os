/**
 * Comisiones bancarias — selector puro.
 *
 * Suma los `bank_movements` marcados role='comision' en cualquiera de los 4
 * bridges (invoice / expense / payroll / client_transfer) y devuelve el
 * desglose por origen, por banco, y sus ratios contra el pago principal y
 * contra el flujo de caja del período.
 *
 * MISMO CONTRATO que el resto de selectores puros del módulo (`revenue.ts`,
 * `kpis.ts`, `bank-report.ts`): NO toca Supabase. El caller lee bridges +
 * bank_movements + fila padre, resuelve moneda a USD y arma el array de
 * `BankFeeRow`. Los tests mockean los arrays directamente.
 *
 * "Comisión" acá es literalmente lo que el operador marcó como tal al
 * conciliar. No inferimos comisiones desde diferencias de monto, ni desde
 * la descripción: si no está el bridge role='comision', no cuenta. Es la
 * única fuente de verdad y elimina falsos positivos.
 */

export type FeeOrigin = "invoice" | "expense" | "payroll" | "transfer";

/**
 * Una comisión bancaria conciliada. Cada fila es un `bank_movement` (kind
 * típicamente 'out') linkeado a un ítem padre con role='comision'.
 *
 * `amount` YA convertido a USD por el caller. Nada acá vuelve a mirar
 * `currency` para calcular — el campo se preserva para agrupar por banco.
 * `principalAmount` es el monto del ítem que generó la comisión (factura
 * cobrada, gasto pagado, sueldo, transferencia). También en USD. `null`
 * cuando no se pudo resolver (fila padre borrada en race, RLS).
 */
export interface BankFeeRow {
  readonly movementId: string;
  readonly bankId: string;
  readonly bankName: string;
  readonly currency: "ARS" | "USD";
  readonly amount: number;
  readonly occurredAt: string;
  readonly origin: FeeOrigin;
  readonly itemId: string;
  readonly itemLabel: string;
  readonly principalAmount: number | null;
}

/**
 * Totales de cash flow del período — se pasan pre-calculados para el ratio
 * "% de comisiones sobre el flujo de caja". Ambos en USD, positivos.
 * Si el caller no los tiene todavía, puede pasar 0 y `ratioVsCashFlow`
 * queda `null`.
 */
export interface BankFeesInputs {
  readonly fees: readonly BankFeeRow[];
  readonly cashInTotal: number;
  readonly cashOutTotal: number;
}

export interface BankFeesOriginBreakdown {
  readonly fees: number;
  readonly count: number;
  /** Σ principalAmount de las comisiones de este origen (ignora nulls). */
  readonly principalTotal: number;
  /** fees / principalTotal. `null` si principalTotal = 0. */
  readonly ratioVsPrincipal: number | null;
}

export interface BankFeesByBank {
  readonly bankId: string;
  readonly bankName: string;
  readonly currency: "ARS" | "USD";
  readonly fees: number;
  readonly count: number;
}

export interface BankFeesBreakdown {
  /** Σ amount de todas las comisiones (USD). */
  readonly totalFees: number;
  /** Cantidad de bank_movements marcados como comisión. */
  readonly count: number;
  /** Desglose por tipo de ítem al que se le cobró la comisión. */
  readonly byOrigin: Record<FeeOrigin, BankFeesOriginBreakdown>;
  /** Desglose por banco. Ordenado descendente por `fees`. */
  readonly byBank: readonly BankFeesByBank[];
  /** totalFees / cashOutTotal. `null` si no hay salidas. */
  readonly ratioVsCashOut: number | null;
  /** totalFees / (cashInTotal + cashOutTotal). `null` si el flujo bruto es 0. */
  readonly ratioVsCashFlow: number | null;
  /** Top 10 comisiones más caras del período. Ordenado descendente por amount. */
  readonly topFees: readonly BankFeeRow[];
}

const EMPTY_ORIGIN: BankFeesOriginBreakdown = Object.freeze({
  fees: 0,
  count: 0,
  principalTotal: 0,
  ratioVsPrincipal: null,
});

export function computeBankFees(inputs: BankFeesInputs): BankFeesBreakdown {
  const byOriginAcc: Record<
    FeeOrigin,
    { fees: number; count: number; principalTotal: number }
  > = {
    invoice: { fees: 0, count: 0, principalTotal: 0 },
    expense: { fees: 0, count: 0, principalTotal: 0 },
    payroll: { fees: 0, count: 0, principalTotal: 0 },
    transfer: { fees: 0, count: 0, principalTotal: 0 },
  };
  const byBankMap = new Map<
    string,
    { bankName: string; currency: "ARS" | "USD"; fees: number; count: number }
  >();
  let totalFees = 0;
  let count = 0;

  for (const f of inputs.fees) {
    totalFees += f.amount;
    count += 1;

    const orig = byOriginAcc[f.origin];
    orig.fees += f.amount;
    orig.count += 1;
    if (f.principalAmount != null) orig.principalTotal += f.principalAmount;

    const cur = byBankMap.get(f.bankId) ?? {
      bankName: f.bankName,
      currency: f.currency,
      fees: 0,
      count: 0,
    };
    cur.fees += f.amount;
    cur.count += 1;
    byBankMap.set(f.bankId, cur);
  }

  function toOriginBreakdown(
    acc: { fees: number; count: number; principalTotal: number },
  ): BankFeesOriginBreakdown {
    if (acc.count === 0) return EMPTY_ORIGIN;
    return {
      fees: acc.fees,
      count: acc.count,
      principalTotal: acc.principalTotal,
      ratioVsPrincipal:
        acc.principalTotal !== 0 ? acc.fees / acc.principalTotal : null,
    };
  }

  const byBank: BankFeesByBank[] = Array.from(byBankMap.entries())
    .map(([bankId, v]) => ({
      bankId,
      bankName: v.bankName,
      currency: v.currency,
      fees: v.fees,
      count: v.count,
    }))
    .sort((a, b) => b.fees - a.fees);

  const cashOutTotal = inputs.cashOutTotal;
  const cashGross = inputs.cashInTotal + inputs.cashOutTotal;

  const topFees = inputs.fees
    .slice()
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10);

  return {
    totalFees,
    count,
    byOrigin: {
      invoice: toOriginBreakdown(byOriginAcc.invoice),
      expense: toOriginBreakdown(byOriginAcc.expense),
      payroll: toOriginBreakdown(byOriginAcc.payroll),
      transfer: toOriginBreakdown(byOriginAcc.transfer),
    },
    byBank,
    ratioVsCashOut: cashOutTotal > 0 ? totalFees / cashOutTotal : null,
    ratioVsCashFlow: cashGross > 0 ? totalFees / cashGross : null,
    topFees,
  };
}
