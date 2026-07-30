/**
 * Cuenta bancaria de la organización (Mercado Pago, Santander, Wise, Stripe…).
 * Post 0101 vive a nivel org; `project_id` quedó como nullable para futuros
 * casos "banco escrow de proyecto puntual". Hoy siempre es null. Los
 * `payment_methods` apuntan al banco donde depositan; el saldo se calcula
 * en runtime desde payments + bank_movements.
 */
export interface BankRow {
  id: string;
  organization_id: string;
  project_id: string | null;
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
  /** Denormalizado desde 0057; scope efectivo desde 0101. */
  organization_id: string;
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
