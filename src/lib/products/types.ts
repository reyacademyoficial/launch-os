/**
 * Shape manual del catálogo de productos. Mismo criterio que
 * PaymentModalityRow: la UI lee este contrato aunque el Database type
 * generado ya tenga la misma info — así el import es explícito.
 *
 * `description` es opcional en la DB; `active=false` saca el producto del
 * selector al cargar ventas pero preserva el histórico (mismo patrón que
 * payment_modalities.active).
 */
export interface ProductRow {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}
