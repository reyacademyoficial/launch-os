/**
 * Resolvedor de "cuál regla de split está vigente para (project, launch)".
 *
 * Vive en su propio archivo (extraído de create.ts en 6c-b) por dos motivos:
 *   1) La aritmética de resolución es lo que decide cuánta plata se reparte,
 *      así que merece ser probable en aislamiento — no atada al orquestador.
 *   2) Un bug latente en la versión anterior filtraba solo por launch_id sin
 *      restringir por project_id: si una fila mal armada (que ya no se puede
 *      crear desde la UI, pero pudo existir de una carga anterior) llevara
 *      un launch de otro proyecto, resolvería a la regla equivocada. Ahora
 *      el filtro es explícito y hay un test que lo pin-ea.
 *
 * REGLA DE PRIORIDAD:
 *   1) Regla activa con launch_id = X (override específico del launch).
 *   2) Si no, regla activa con launch_id IS NULL para ese project_id (default).
 *   Ambas siempre filtradas por project_id — el resolver no confía en que
 *   la RPC 0097 sea la única puerta de entrada.
 *
 * El unique parcial de settlement_rules garantiza que a lo sumo hay una fila
 * activa por (project_id, launch_id) — por eso el maybeSingle no puede tirar.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { SettlementRuleRow } from "./types";

type AnySupabase = SupabaseClient<any, any, any>;

export interface RuleScope {
  readonly launchId: string;
  readonly projectId: string;
}

export async function resolveActiveRule(
  supabase: AnySupabase,
  scope: RuleScope,
): Promise<SettlementRuleRow | null> {
  const launchScoped = await supabase
    .from("settlement_rules")
    .select("*")
    .eq("project_id", scope.projectId)
    .eq("launch_id", scope.launchId)
    .eq("active", true)
    .maybeSingle();

  const launchRule = launchScoped.data as unknown as SettlementRuleRow | null;
  if (launchRule) return launchRule;

  const projectDefault = await supabase
    .from("settlement_rules")
    .select("*")
    .eq("project_id", scope.projectId)
    .is("launch_id", null)
    .eq("active", true)
    .maybeSingle();

  return (projectDefault.data as unknown as SettlementRuleRow | null) ?? null;
}
