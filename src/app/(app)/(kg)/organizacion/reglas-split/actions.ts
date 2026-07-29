"use server";

import { revalidatePath } from "next/cache";

import {
  computeLaunchAggregates,
  type LaunchAggregates,
} from "@/lib/settlements/aggregates";
import { requireRole } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import type { SettlementAppliesOn } from "@/lib/settlements/types";

import { translateRotateRuleError } from "./translate-error";

// ═══════════════════════════════════════════════════════════════════════════
// Contratos de retorno
// ═══════════════════════════════════════════════════════════════════════════

export type RotateRuleState =
  | { ok: true; ruleId: string }
  | { error: string }
  | null;

export interface RotateRulePayload {
  readonly organizationId: string;
  readonly projectId: string;
  readonly launchId: string | null;
  readonly name: string;
  readonly percentOfCollected: number;
  readonly fixedFeePerLaunch: number;
  readonly fixedFeePerSale: number;
  readonly minGuarantee: number | null;
  readonly appliesOn: SettlementAppliesOn;
}

// ═══════════════════════════════════════════════════════════════════════════
// rotateRule — invoca la RPC atómica de 0097. Sirve tanto para crear una
// regla nueva como para reemplazar una existente (misma operación: la RPC
// desactiva la vigente para el scope y crea la nueva en una sola tx).
// ═══════════════════════════════════════════════════════════════════════════

export async function rotateRule(
  payload: RotateRulePayload,
): Promise<RotateRuleState> {
  await requireRole("superadmin");

  if (payload.name.trim().length === 0) {
    return { error: "El nombre de la regla es obligatorio." };
  }
  if (
    payload.percentOfCollected < 0 ||
    payload.percentOfCollected > 100 ||
    !Number.isFinite(payload.percentOfCollected)
  ) {
    return { error: "El porcentaje tiene que estar entre 0 y 100." };
  }
  if (
    payload.fixedFeePerLaunch < 0 ||
    payload.fixedFeePerSale < 0 ||
    !Number.isFinite(payload.fixedFeePerLaunch) ||
    !Number.isFinite(payload.fixedFeePerSale)
  ) {
    return { error: "Los cargos fijos no pueden ser negativos." };
  }
  if (
    payload.minGuarantee != null &&
    (!Number.isFinite(payload.minGuarantee) || payload.minGuarantee < 0)
  ) {
    return { error: "La garantía mínima no puede ser negativa." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rotate_settlement_rule", {
    p_organization_id: payload.organizationId,
    p_project_id: payload.projectId,
    p_launch_id: payload.launchId,
    p_name: payload.name.trim(),
    p_percent_of_collected: payload.percentOfCollected,
    p_fixed_fee_per_launch: payload.fixedFeePerLaunch,
    p_fixed_fee_per_sale: payload.fixedFeePerSale,
    p_min_guarantee: payload.minGuarantee,
    p_applies_on: payload.appliesOn,
  } as never);

  if (error) {
    return { error: translateRotateRuleError(error) };
  }

  const created = data as { id: string } | null;
  if (!created) {
    return { error: "La operación no devolvió una regla." };
  }

  revalidatePath("/organizacion/reglas-split");
  return { ok: true, ruleId: created.id };
}

// ═══════════════════════════════════════════════════════════════════════════
// fetchLaunchAggregates — para el simulador. Cero escrituras. Delegado a
// computeLaunchAggregates de src/lib/settlements/aggregates, la misma
// función que usa el orquestador que persiste liquidaciones — el simulador
// y la liquidación real no pueden mostrar números distintos porque leen
// del mismo lugar.
// ═══════════════════════════════════════════════════════════════════════════

export async function fetchLaunchAggregates(
  launchId: string,
): Promise<LaunchAggregates> {
  await requireRole("superadmin");
  const supabase = await createClient();
  return computeLaunchAggregates(supabase, launchId);
}
