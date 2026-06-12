/**
 * leads row, definido a mano hasta que el types regen incluya la tabla 0013.
 *
 * `source` arranca con 4 valores; la lista crece cuando se cableen providers
 * automáticos. El check constraint en la DB es la fuente autoritativa — si se
 * agrega un valor, sumarlo acá también.
 *
 * `import` (0016) marca leads que entraron por el wizard de xlsx masivo, para
 * distinguirlos de los cargados a mano (`manual`) — útil para auditar/filtrar.
 */
export type LeadSource =
  | "manual"
  | "import"
  | "meta"
  | "ghl"
  | "whatsapp"
  | "otro";

/**
 * Status del lead. Cambió en 3b — el modelo viejo (nuevo/contactado/calificado)
 * mezclaba "etapa del setter" con "calor del lead". Ahora refleja actividad
 * real:
 *   - frio: lead nuevo con poca o nula actividad (1 msg de WhatsApp o solo
 *     formulario sin más).
 *   - tibio: lead que respondió (2+ mensajes inbound en WhatsApp).
 *   - agendado: tiene appointment en GHL.
 *   - cerrado: tag "cliente" en GHL o cierre manual.
 *   - perdido: cierre negativo manual.
 *
 * Migración 0018 mapea los valores anteriores.
 */
export type LeadStatus =
  | "frio"
  | "tibio"
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
 * Orden canónico de columnas del kanban. Reusado por la UI y por los selects
 * de status en formularios. "cerrado" y "perdido" cierran el pipeline.
 */
export const LEAD_STATUSES: readonly LeadStatus[] = [
  "frio",
  "tibio",
  "agendado",
  "cerrado",
  "perdido",
] as const;

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  frio: "Frío",
  tibio: "Tibio",
  agendado: "Agendado",
  cerrado: "Cerrado",
  perdido: "Perdido",
};
