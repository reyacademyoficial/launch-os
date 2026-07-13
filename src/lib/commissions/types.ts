/**
 * Shapes manuales (cast at the boundary, igual que team/leads). Cuando se
 * regeneren los types con `supabase gen types` estos van a quedar redundantes
 * con `Database["public"]["Tables"][...]["Row"]`, pero los dejamos explícitos
 * porque la UI los lee como contrato.
 *
 * MODELO 4d — una regla tiene:
 *   - N tiers (al menos 1) marginales por cantidad de ventas en el launch.
 *   - 1..N modalidades (vía pivot commission_rule_modalities).
 *   - Un modo de devengamiento (`accrual_mode`) y, si aplica, un threshold.
 */

export type CommissionTierType = "percent" | "fixed";

export type AccrualMode =
  | "proportional"
  | "threshold_full"
  | "threshold_proportional"
  /**
   * `on_close`: comisión liberada al 100% en el momento de cierre.
   * No mira `payments`. base = pledged (sale.total_amount).
   * Casos típicos: "20% al cerrar" o "$100 fijos por venta cerrada".
   */
  | "on_close";

export type ThresholdType = "payment_count" | "paid_ratio";

export interface PaymentModalityRow {
  id: string;
  project_id: string;
  name: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CommissionRuleTierRow {
  id: string;
  rule_id: string;
  /** 0-based: la 1ra venta del miembro en el launch es rank=0. */
  min_count: number;
  /** NULL = sin tope (tier final). */
  max_count: number | null;
  type: CommissionTierType;
  value: number;
  created_at: string;
  updated_at: string;
}

/**
 * Regla "rica" — incluye tiers + modalidades ya hidratadas. Es lo que consume
 * el calc y la UI. La DB las guarda en 3 tablas (commission_rules + tiers +
 * pivot); `listCommissionRules` se encarga de armarla.
 *
 * Scope XOR (constraint SQL): `launch_id` y `product_id` nunca están
 * setteados los dos a la vez. Los tres estados válidos son:
 *   - launch_id=X, product_id=null → override por launch
 *   - launch_id=null, product_id=Y → override por producto
 *   - launch_id=null, product_id=null → default del proyecto
 */
export interface CommissionRuleRow {
  id: string;
  project_id: string;
  launch_id: string | null;
  product_id: string | null;
  accrual_mode: AccrualMode;
  threshold_type: ThresholdType | null;
  threshold_value: number | null;
  /** Modalidades de pago a las que aplica la regla (>= 1 fila en pivot). */
  modality_ids: string[];
  /** Tiers ordenados por min_count asc. Al menos 1. */
  tiers: CommissionRuleTierRow[];
  created_at: string;
  updated_at: string;
}

/**
 * Snapshot congelado en `sales.commission_rule_snapshot` al momento de
 * cerrar la venta. Guarda TODO lo que necesita `computeCommission` para
 * derivar la comisión sin ir a buscar la regla vigente. Cambios posteriores
 * a la regla no afectan la comisión de esta venta.
 *
 * Se guarda como jsonb en la DB pero acá lo tipamos para el consumo del
 * calc. Casteo con `as unknown as CommissionRuleSnapshot` en la boundary
 * de PostgREST — mismo patrón que el resto.
 */
export interface CommissionRuleSnapshot {
  accrual_mode: AccrualMode;
  threshold_type: ThresholdType | null;
  threshold_value: number | null;
  tiers: Array<{
    min_count: number;
    max_count: number | null;
    type: CommissionTierType;
    value: number;
  }>;
}

export interface SaleRow {
  id: string;
  project_id: string;
  lead_id: string;
  /**
   * Launch al que pertenece esta venta específica (Fase 8). NULL para
   * ventas off-books o para las que no lograron backfill (lead sin
   * launch_id al momento de la migración 0041). Atribución de venta a
   * launch va por acá, no por `lead.launch_id`.
   */
  launch_id: string | null;
  team_member_id: string | null;
  payment_modality_id: string;
  product_id: string;
  total_amount: number;
  closed_at: string;
  /**
   * Regla congelada al cierre. NULL solo para ventas legacy que no lograron
   * backfill en la migración 0039 (sin regla que matchee ese día). Cuando
   * es NULL, `computeCommission` cae al fallback de buscar la regla vigente.
   */
  commission_rule_snapshot: CommissionRuleSnapshot | null;
  created_at: string;
  updated_at: string;
}

export interface PaymentRow {
  id: string;
  sale_id: string;
  amount: number;
  paid_at: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
