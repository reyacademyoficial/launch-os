/**
 * Tipos org-level para el módulo Clientes de Kingrow (Bloque 3).
 *
 * "Cliente" acá = `project` gestionado (empresa), NO cliente final del launch.
 * Los selectores en health.ts / ltv.ts / churn.ts leen estos shapes; el
 * caller (server action / loader) es responsable de castear las rows de
 * Supabase antes de pasarlas. Los selectores NUNCA tocan Supabase (patrón
 * `kpis.ts` / `finance/kpis.ts` / `settlements/calc.ts`).
 *
 * Solo se declaran los campos que los selectores realmente leen — objetos
 * con columnas extra pasan sin ruido. Cuando se regenere Database.types.ts
 * con `supabase gen types`, quedan como subset compatible.
 */

// ═══════════════════════════════════════════════════════════════════════════
// project_health (0080)
// ═══════════════════════════════════════════════════════════════════════════

export type RelationshipStatus =
  | "onboarding"
  | "activa"
  | "en_riesgo"
  | "perdida";

export interface ProjectHealthRow {
  project_id: string;
  organization_id: string;
  health_score: number | null;
  relationship_status: RelationshipStatus;
  last_contact_at: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// nps_responses (0081)
// ═══════════════════════════════════════════════════════════════════════════

export type NpsBucket = "promoter" | "passive" | "detractor";

export interface NpsResponseRow {
  project_id: string;
  score: number; // 0..10
  responded_at: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// tickets (0082)
// ═══════════════════════════════════════════════════════════════════════════

export type TicketStatus =
  | "abierto"
  | "en_progreso"
  | "esperando_cliente"
  | "resuelto"
  | "cerrado";

export type TicketPriority = "baja" | "media" | "alta" | "urgente";

export interface TicketRow {
  project_id: string;
  status: TicketStatus;
  priority: TicketPriority;
  created_at: string;
  resolved_at: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// renewals (0083)
// ═══════════════════════════════════════════════════════════════════════════

export type RenewalStatus =
  | "propuesta"
  | "confirmada"
  | "facturada"
  | "cobrada"
  | "perdida";

export interface RenewalRow {
  project_id: string;
  period_start: string;
  period_end: string;
  amount: number;
  status: RenewalStatus;
  collected_at: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// upsells (0084)
// ═══════════════════════════════════════════════════════════════════════════

export type UpsellStatus = RenewalStatus; // misma máquina de estados

export interface UpsellRow {
  project_id: string;
  amount: number;
  status: UpsellStatus;
  closed_at: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// launch_settlements (subset para LTV)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Subset de `launch_settlements` (0055). Para LTV usamos kingrow_retained
 * de status ∈ {liquidada, transferida} — mismo criterio que finance/revenue.
 * NO reimportamos de finance/types para evitar acoplar dos módulos que
 * podrían divergir en el futuro (p.ej. si LTV pasa a devengado).
 */
export interface ClientsSettlementRow {
  project_id: string;
  kingrow_retained: number;
  status: "abierta" | "liquidada" | "transferida";
}

// ═══════════════════════════════════════════════════════════════════════════
// invoices (subset para LTV)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Subset de `invoices` (0064). Para LTV solo cuentan las 'cobrada' con
 * project_id != null (las corporativas sin proyecto no atribuyen a un
 * cliente puntual). NETO de IVA — el fisco no es ingreso.
 */
export interface ClientsInvoiceRow {
  project_id: string | null;
  amount_gross: number;
  tax_amount: number;
  status: "emitida" | "cobrada" | "vencida" | "anulada";
}
