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
  created_at: string;
  updated_at: string;
}
