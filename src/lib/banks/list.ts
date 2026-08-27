import "server-only";

import { createClient } from "@/lib/supabase/server";

import type { BankMovementRow, BankRow } from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// Selectores org-scope (post 0101) — la única forma correcta después de la
// migración. Los bancos son de Kingrow, no del proyecto; los movimientos
// también. RLS filtra por can_edit_organization; superadmin ve todo.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Todos los bancos que el usuario tiene permitido ver (RLS filtra por org).
 * Ordenados con activos arriba y alfa dentro de cada grupo — mismo criterio
 * que products / payment_methods.
 */
export async function listBanks(): Promise<BankRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("banks")
    .select("*")
    .order("active", { ascending: false })
    .order("name", { ascending: true });
  return (data ?? []) as unknown as BankRow[];
}

/**
 * Bancos EXTERNOS del proyecto — canales por los que cobra un cliente que
 * NO son cuenta de Kingrow (post 0169). Selector específico para el módulo
 * de liquidaciones: nos permite listar los canales que un cliente externo
 * usa para cobrar y clasificar sus pagos en la liquidación, sin que esos
 * bancos contaminen saldos, cash flow o bank report de Kingrow.
 *
 * Filtra `is_external_collector = true AND external_project_id = projectId`
 * (bicondicional garantizado por CHECK en DB — ver mig 0169). Mismo
 * criterio de orden que `listBanks`: activos arriba, alfa dentro de cada
 * grupo. RLS org-scope aplica igual.
 *
 * `listBanks` NO cambia — sigue devolviendo todos los bancos (propios +
 * externos) para admin. Los cálculos derivados (`computeBankBalances`,
 * `buildBankReport`) son los que descartan los externos en origen.
 */
export async function listExternalCollectorBanks(
  projectId: string,
): Promise<BankRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("banks")
    .select("*")
    .eq("is_external_collector", true)
    .eq("external_project_id", projectId)
    .order("active", { ascending: false })
    .order("name", { ascending: true });
  return (data ?? []) as unknown as BankRow[];
}

/**
 * Todos los movimientos de todos los bancos que el usuario puede ver. RLS
 * filtra por can_edit_organization (misma frontera que el resto del módulo
 * financiero). Ordenados por fecha desc + created_at desc para estabilidad
 * cuando hay dos movimientos el mismo día.
 */
export async function listBankMovements(): Promise<BankMovementRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("bank_movements")
    .select("*")
    .order("occurred_at", { ascending: false })
    .order("created_at", { ascending: false });
  return (data ?? []) as unknown as BankMovementRow[];
}
