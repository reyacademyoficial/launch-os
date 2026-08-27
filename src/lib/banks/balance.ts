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
 *
 * Post 0169: los bancos con `is_external_collector = true` NO son cuenta de
 * Kingrow (son canales de cobro del cliente externo). Se excluyen por
 * completo del Map — ni siquiera aparecen con saldo 0. Los movimientos que
 * apunten a esos bancos también se descartan defensivamente (no debería
 * haberlos, pero si el operador cargó movimientos informativos no deben
 * afectar la contabilidad de Kingrow).
 */
export function computeBankBalances(
  banks: ReadonlyArray<BankRow>,
  movements: ReadonlyArray<Pick<BankMovementRow, "bank_id" | "kind" | "amount">>,
): Map<string, BankBalance> {
  const out = new Map<string, BankBalance>();
  for (const b of banks) {
    if (b.is_external_collector) continue;
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
