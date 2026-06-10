/**
 * team_members row, as it lives in the DB. Definido a mano hasta que el types
 * regen incluya la tabla 0013 — el patrón es el mismo que en lib/leads/types.ts.
 */
export type TeamMemberRole =
  | "setter"
  | "closer"
  | "media_buyer"
  | "manager"
  | "otro";

export interface TeamMemberRow {
  id: string;
  project_id: string;
  name: string;
  role: TeamMemberRole;
  commission_rate: number | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}
