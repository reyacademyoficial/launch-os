/**
 * Tipos de settlement_rules / launch_settlements / client_transfers.
 *
 * Shapes manuales (cast at the boundary, mismo estilo que commissions/types).
 * Cuando se regeneren los types con `supabase gen types` van a quedar
 * redundantes con `Database["public"]["Tables"][...]["Row"]`, pero los
 * dejamos explícitos porque el calc los lee como contrato.
 */

export type SettlementAppliesOn = "collected" | "sold";
export type LaunchSettlementStatus = "abierta" | "liquidada" | "transferida";
export type ClientTransferDirection = "a_favor_cliente" | "transferido";
export type LaunchCollector = "kingrow" | "cliente";

/**
 * Fila persistida de settlement_rules. El snapshot (jsonb) que se guarda en
 * launch_settlements es un subset semánticamente equivalente — ver
 * SettlementRuleSnapshot abajo.
 */
export interface SettlementRuleRow {
  id: string;
  organization_id: string;
  project_id: string;
  launch_id: string | null;
  name: string;
  percent_of_collected: number;
  fixed_fee_per_launch: number;
  fixed_fee_per_sale: number;
  min_guarantee: number | null;
  applies_on: SettlementAppliesOn;
  active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Regla congelada en launch_settlements.settlement_rule_snapshot al momento
 * de la liquidación. Cambiar la regla original NO reescribe este snapshot.
 * Es lo único que calc.ts necesita para reproducir los montos de una
 * liquidación pasada.
 */
export interface SettlementRuleSnapshot {
  name: string;
  percent_of_collected: number;
  fixed_fee_per_launch: number;
  fixed_fee_per_sale: number;
  min_guarantee: number | null;
  applies_on: SettlementAppliesOn;
}

export interface LaunchSettlementRow {
  id: string;
  organization_id: string;
  launch_id: string;
  project_id: string;
  settlement_rule_snapshot: SettlementRuleSnapshot;
  collected_total: number;
  kingrow_retained: number;
  owed_to_client: number;
  status: LaunchSettlementStatus;
  created_at: string;
  closed_at: string | null;
}

export interface ClientTransferRow {
  id: string;
  organization_id: string;
  project_id: string;
  launch_settlement_id: string | null;
  bank_movement_id: string | null;
  amount: number;
  direction: ClientTransferDirection;
  date: string;
  notes: string | null;
  created_at: string;
}

/**
 * Extrae el snapshot desde una regla persistida. Uso: la server action que
 * liquida un launch primero lee la regla vigente (settlement_rules), extrae
 * el snapshot con esta función, computa con calc.ts, y persiste la fila
 * `launch_settlements` con el snapshot embebido.
 */
export function toSettlementRuleSnapshot(
  rule: SettlementRuleRow,
): SettlementRuleSnapshot {
  return {
    name: rule.name,
    percent_of_collected: rule.percent_of_collected,
    fixed_fee_per_launch: rule.fixed_fee_per_launch,
    fixed_fee_per_sale: rule.fixed_fee_per_sale,
    min_guarantee: rule.min_guarantee,
    applies_on: rule.applies_on,
  };
}
