/**
 * Shape manual de `team_member_payouts` — cast at the boundary, mismo patrón
 * que `commissions/types.ts`. Hasta que el regen de `supabase gen types`
 * incorpore la tabla.
 */
export interface TeamMemberPayoutRow {
  id: string;
  project_id: string;
  team_member_id: string;
  launch_id: string;
  amount: number;
  paid_at: string; // YYYY-MM-DD
  notes: string | null;
  created_at: string;
  updated_at: string;
}
