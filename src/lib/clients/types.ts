/**
 * Tipos org-level para el módulo Clientes de Kingrow (Bloque 3 + 3.5).
 *
 * "Cliente" acá = empresa B2B externa (fila en `clients`, migración 0110),
 * NO cliente final del launch. Las 5 tablas del bloque 3 (project_health,
 * nps_responses, tickets, renewals, upsells) pivotearon a client_id en
 * migración 0110 — vive con el cliente, no con un launch.
 *
 * Excepción: TicketRow mantiene project_id OPCIONAL para el caso "esto
 * pasa en un launch específico". El trigger de tickets valida que si
 * project_id está seteado, el project pertenece al mismo cliente.
 *
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
// clients (0110)
// ═══════════════════════════════════════════════════════════════════════════

export interface ClientRow {
  id: string;
  organization_id: string;
  name: string;
  business_name: string | null;
  industry: string | null;
  active: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// project_health (0080 → 0110)
// ═══════════════════════════════════════════════════════════════════════════

export type RelationshipStatus =
  | "onboarding"
  | "activa"
  | "en_riesgo"
  | "perdida";

export interface ProjectHealthRow {
  client_id: string;
  organization_id: string;
  health_score: number | null;
  relationship_status: RelationshipStatus;
  last_contact_at: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// nps_responses (0081 → 0110)
// ═══════════════════════════════════════════════════════════════════════════

export type NpsBucket = "promoter" | "passive" | "detractor";

export interface NpsResponseRow {
  client_id: string;
  score: number; // 0..10
  responded_at: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// tickets (0082 → 0110)
//
// client_id NOT NULL, project_id OPCIONAL. Un ticket vive con el cliente;
// project_id atado solo si el ticket es específico de un launch (rota una
// campaña, cambio de plan en un launch puntual).
// ═══════════════════════════════════════════════════════════════════════════

export type TicketStatus =
  | "abierto"
  | "en_progreso"
  | "esperando_cliente"
  | "resuelto"
  | "cerrado";

export type TicketPriority = "baja" | "media" | "alta" | "urgente";

export interface TicketRow {
  client_id: string;
  project_id: string | null;
  status: TicketStatus;
  priority: TicketPriority;
  created_at: string;
  resolved_at: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// renewals (0083 → 0110)
// ═══════════════════════════════════════════════════════════════════════════

export type RenewalStatus =
  | "propuesta"
  | "confirmada"
  | "facturada"
  | "cobrada"
  | "perdida";

export interface RenewalRow {
  client_id: string;
  period_start: string;
  period_end: string;
  amount: number;
  status: RenewalStatus;
  collected_at: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// upsells (0084 → 0110)
// ═══════════════════════════════════════════════════════════════════════════

export type UpsellStatus = RenewalStatus; // misma máquina de estados

export interface UpsellRow {
  client_id: string;
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
