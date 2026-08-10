/**
 * team_members row, as it lives in the DB. Definido a mano hasta que el types
 * regen incluya la tabla — mismo patrón que en lib/leads/types.ts.
 *
 * Post 0124: team_members es org-scope. `project_id` queda como columna
 * nullable deprecada (0124 lo comenta explícito), pero no la leemos más.
 */
export type TeamMemberRole =
  | "setter"
  | "closer"
  | "media_buyer"
  | "manager"
  | "otro";

export interface TeamMemberRow {
  id: string;
  organization_id: string;
  name: string;
  role: TeamMemberRole;
  commission_rate: number | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}
