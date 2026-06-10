/**
 * leads row, definido a mano hasta que el types regen incluya la tabla 0013.
 *
 * `source` arranca con 4 valores; la lista crece cuando se cableen providers
 * automáticos. El check constraint en la DB es la fuente autoritativa — si se
 * agrega un valor, sumarlo acá también.
 */
export type LeadSource = "manual" | "meta" | "ghl" | "otro";

export type LeadStatus =
  | "nuevo"
  | "contactado"
  | "calificado"
  | "agendado"
  | "cerrado"
  | "perdido";

export interface LeadRow {
  id: string;
  project_id: string;
  launch_id: string | null;
  team_member_id: string | null;
  name: string;
  contact: string | null;
  source: LeadSource;
  status: LeadStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Orden canónico de columnas del kanban. Reusado por la UI y por los selects
 * de status en formularios. "cerrado" y "perdido" cierran el pipeline.
 */
export const LEAD_STATUSES: readonly LeadStatus[] = [
  "nuevo",
  "contactado",
  "calificado",
  "agendado",
  "cerrado",
  "perdido",
] as const;

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  nuevo: "Nuevo",
  contactado: "Contactado",
  calificado: "Calificado",
  agendado: "Agendado",
  cerrado: "Cerrado",
  perdido: "Perdido",
};
