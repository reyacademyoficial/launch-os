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
