import type { BankBalance, BankMovementRow, BankRow } from "./types";

function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  const n = parseFloat(v as string);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Saldo agregado por banco.
 *
 * Regla única: `total = opening + movementsIn − movementsOut`. Los cobros
 * (`payments`) NO alimentan el balance del banco. Ese cambio se cerró en
 * la refactorización financiera post-reunión: los movimientos son la única
 * fuente de verdad de qué pasó en el banco. Los cobros son una capa
 * contable (qué se cobró, aplicado a qué factura) que se concilia con
 * movimientos vía `transaction_number` y links factura ↔ movimiento.
 *
 * Cobrado por método sigue existiendo — vive en `/financiero/metodos-pago`
 * como métrica de trazabilidad, sin sumar a balances.
 */
export function computeBankBalances(
  banks: ReadonlyArray<BankRow>,
  movements: ReadonlyArray<Pick<BankMovementRow, "bank_id" | "kind" | "amount">>,
): Map<string, BankBalance> {
  const out = new Map<string, BankBalance>();
  for (const b of banks) {
    out.set(b.id, {
      bank_id: b.id,
      opening: toNum(b.opening_balance),
      movementsIn: 0,
      movementsOut: 0,
      total: toNum(b.opening_balance),
    });
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
