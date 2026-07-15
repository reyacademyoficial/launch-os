/**
 * Cuenta bancaria del proyecto (Galicia AR, Wise, PayPal, MercadoPago…).
 * Los `payment_methods` apuntan al banco donde depositan; el saldo se
 * calcula en runtime desde payments + bank_movements.
 */
export interface BankRow {
  id: string;
  project_id: string;
  name: string;
  /** Saldo inicial cargado por el operador para arrancar sin backfill histórico. */
  opening_balance: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export type BankMovementKind = "in" | "out";

/**
 * Ingreso o egreso manual sobre un banco. NO reemplaza a `payments` (cobros de
 * venta se agregan al saldo automáticamente por el link method → bank); acá
 * viven las cosas que no son venta: gastos, retiros, transferencias inter-
 * bancos, ajustes.
 */
export interface BankMovementRow {
  id: string;
  bank_id: string;
  kind: BankMovementKind;
  amount: number;
  occurred_at: string;
  description: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Detalle del saldo agregado por banco. Se compone en `computeBankBalances` a
 * partir de opening_balance + cobros vía métodos linkeados + movimientos.
 */
export interface BankBalance {
  bank_id: string;
  opening: number;
  fromPayments: number;
  movementsIn: number;
  movementsOut: number;
  total: number;
}
