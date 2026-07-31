/**
 * Método de pago: por dónde entra la plata (transferencia, Stripe, efectivo…).
 * NO confundir con `PaymentModalityRow` (contado / N cuotas), que es la
 * variable que define la regla de comisión. Método es información contable.
 *
 * Mismo patrón CRUD/RLS que `products`: project-scoped, active flag para
 * preservar histórico al "borrar".
 */
export interface PaymentMethodRow {
  id: string;
  project_id: string;
  name: string;
  active: boolean;
  /**
   * Banco donde depositan los cobros que entran por este método (Fase 12,
   * mig 0044). NULL = método sin depósito (efectivo en mano, histórico sin
   * backfill). Los cobros con `payment_method_id` cuyo method tiene bank_id
   * suman al saldo del banco en runtime.
   */
  bank_id: string | null;
  /**
   * Moneda del método CUANDO no tiene banco (efectivo, otros). Si `bank_id`
   * está seteado, la moneda efectiva se hereda del banco y esta columna
   * queda null para evitar dos fuentes de verdad. Ver `effectiveCurrency`
   * en `@/lib/money`.
   */
  currency: "ARS" | "USD" | null;
  created_at: string;
  updated_at: string;
}
