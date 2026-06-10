/**
 * Shapes manuales (cast at the boundary, igual que team/leads). Cuando se
 * regeneren los types con `supabase gen types` estos van a quedar redundantes
 * con `Database["public"]["Tables"][...]["Row"]`, pero los dejamos explícitos
 * porque la UI los lee como contrato.
 */

export type CommissionRuleType = "percent" | "fixed";

export interface PaymentModalityRow {
  id: string;
  project_id: string;
  name: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CommissionRuleRow {
  id: string;
  project_id: string;
  payment_modality_id: string;
  launch_id: string | null;
  type: CommissionRuleType;
  value: number;
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
