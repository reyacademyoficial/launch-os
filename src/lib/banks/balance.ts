import type { PaymentRow } from "@/lib/commissions/types";
import type { PaymentMethodRow } from "@/lib/payment-methods/types";

import type { BankBalance, BankMovementRow, BankRow } from "./types";

function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  const n = parseFloat(v as string);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Calcula el saldo agregado por banco en runtime. Igual que en las views de
 * comisiones, todo es determinista a partir del universo actual: no hay
 * balance persistido que se pueda desincronizar al editar/borrar cobros o
 * movimientos.
 *
 * Reglas:
 *   - `opening` viene de bank.opening_balance (saldo inicial cargado).
 *   - `fromPayments` = Σ payments.amount donde el payment_method está
 *     linkeado al bank. Cobros sin método asignado o con método sin bank_id
 *     NO cuentan (no sabemos dónde depositaron).
 *   - `movementsIn / movementsOut` = Σ bank_movements.amount según kind.
 *   - `total = opening + fromPayments + movementsIn − movementsOut`.
 */
export function computeBankBalances(
  banks: ReadonlyArray<BankRow>,
  paymentMethods: ReadonlyArray<PaymentMethodRow>,
  payments: ReadonlyArray<Pick<PaymentRow, "amount" | "payment_method_id">>,
  movements: ReadonlyArray<Pick<BankMovementRow, "bank_id" | "kind" | "amount">>,
): Map<string, BankBalance> {
  // method_id → bank_id (excluye métodos sin banco).
  const bankByMethod = new Map<string, string>();
  for (const m of paymentMethods) {
    if (m.bank_id) bankByMethod.set(m.id, m.bank_id);
  }

  const out = new Map<string, BankBalance>();
  for (const b of banks) {
    out.set(b.id, {
      bank_id: b.id,
      opening: toNum(b.opening_balance),
      fromPayments: 0,
      movementsIn: 0,
      movementsOut: 0,
      total: toNum(b.opening_balance),
    });
  }

  for (const p of payments) {
    if (!p.payment_method_id) continue;
    const bankId = bankByMethod.get(p.payment_method_id);
    if (!bankId) continue;
    const bal = out.get(bankId);
    if (!bal) continue;
    const amt = toNum(p.amount);
    bal.fromPayments += amt;
    bal.total += amt;
  }

  for (const mv of movements) {
    const bal = out.get(mv.bank_id);
    if (!bal) continue;
    const amt = toNum(mv.amount);
    if (mv.kind === "in") {
      bal.movementsIn += amt;
      bal.total += amt;
    } else {
      bal.movementsOut += amt;
      bal.total -= amt;
    }
  }

  return out;
}
