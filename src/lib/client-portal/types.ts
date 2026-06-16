import type { LeadSource, LeadStatus } from "@/lib/leads/types";

/**
 * Forma de un lead visible para el cliente. Idéntica a `LeadRow` del equipo
 * pero SIN `team_member_id` (asignación setter/closer, cocina interna).
 *
 * Dos por qué de tener un tipo separado:
 *   1. Tipea explícito el contrato del portal — un cambio en el schema que
 *      no se refleje en este tipo evita que el cliente pida la columna nueva
 *      sin querer.
 *   2. La frontera dura está en la DB (grant column-level a `cliente_role`
 *      sin `team_member_id`, migración 0023); este tipo es el espejo en TS.
 */
export interface ClientLeadRow {
  id: string;
  project_id: string;
  launch_id: string | null;
  name: string;
  contact: string | null;
  email: string | null;
  phone_normalized: string | null;
  external_id: string | null;
  pinned_to_kanban: boolean;
  source: LeadSource;
  status: LeadStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Resultado paginado de la búsqueda de leads del cliente. Mismo contrato que
 * el del equipo (rows + totalCount + page + pageSize + totalPages) para que el
 * componente de paginación se reutilice tal cual.
 */
export interface ClientLeadSearchResult {
  rows: ClientLeadRow[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
