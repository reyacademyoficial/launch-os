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
  | "threshold_proportional";

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
 */
export interface CommissionRuleRow {
  id: string;
  project_id: string;
  launch_id: string | null;
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

export interface SaleRow {
  id: string;
  project_id: string;
  lead_id: string;
  team_member_id: string | null;
  payment_modality_id: string;
  total_amount: number;
  closed_at: string;
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
