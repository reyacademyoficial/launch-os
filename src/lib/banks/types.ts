/**
 * Cuenta bancaria de la organización (Mercado Pago, Santander, Wise, Stripe…).
 * Post 0101 vive a nivel org; `project_id` quedó como nullable para futuros
 * casos "banco escrow de proyecto puntual". Hoy siempre es null. El saldo se
 * calcula en runtime desde `opening_balance + bank_movements` — los cobros
 * NO alimentan el balance.
 *
 * Post 0169 un banco puede ser MARCADOR DE CANAL EXTERNO: representa el banco
 * por el que cobra un cliente externo (no es plata de Kingrow). Se registra
 * para poder cargar ventas + cobros del cliente y calcular la liquidación,
 * pero se excluye de saldos, cash flow y conciliación reales. Los dos flags
 * son bicondicionales por CHECK en DB (`banks_external_collector_coherence`).
 */
export interface BankRow {
  id: string;
  organization_id: string;
  project_id: string | null;
  name: string;
  /** Saldo inicial cargado por el operador para arrancar sin backfill histórico. */
  opening_balance: number;
  /** Moneda nativa del banco. Los cobros/movimientos se cargan siempre en esta moneda. */
  currency: "ARS" | "USD";
  active: boolean;
  /**
   * true = banco NO es cuenta de Kingrow; representa el canal por el que cobra
   * un cliente externo. Excluido de balances/cash flow. Sigue siendo destino
   * válido de payment_methods.bank_id para clasificar pagos como "cobrado por
   * el cliente" en la liquidación. Ver mig 0169.
   */
  is_external_collector: boolean;
  /**
   * Proyecto (cliente externo) al que pertenece este canal. NOT NULL cuando
   * is_external_collector=true; NULL cuando es banco propio. Bicondicional
   * enforced por CHECK en DB.
   */
  external_project_id: string | null;
  created_at: string;
  updated_at: string;
}

export type BankMovementKind = "in" | "out";

/**
 * Ingreso o egreso sobre un banco. Es la ÚNICA fuente que mueve el balance del
 * banco: gastos, retiros, transferencias inter-bancos, ajustes, y también los
 * ingresos por cobros conciliados (el operador carga el movimiento entrante y
 * lo linkea a la factura vía `transaction_number`).
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
 * Detalle del saldo agregado por banco. `total = opening + movementsIn −
 * movementsOut`. Los cobros (`payments`) NO alimentan el balance del banco —
 * ver `computeBankBalances`.
 */
export interface BankBalance {
  bank_id: string;
  opening: number;
  movementsIn: number;
  movementsOut: number;
  total: number;
}
