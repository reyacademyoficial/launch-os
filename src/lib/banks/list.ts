import "server-only";

import { createClient } from "@/lib/supabase/server";

import type { BankMovementRow, BankRow } from "./types";

/**
 * Bancos del proyecto. Ordenados con activos arriba y alfa dentro de cada
 * grupo — mismo criterio que products / payment_methods.
 */
export async function listBanksForProject(
  projectId: string,
): Promise<BankRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("banks")
    .select("*")
    .eq("project_id", projectId)
    .order("active", { ascending: false })
    .order("name", { ascending: true });

  return (data ?? []) as unknown as BankRow[];
}

/**
 * Todos los movimientos de todos los bancos del proyecto. RLS filtra por
 * `project_of_bank(bank_id)` — cada movimiento es visible si el usuario ve
 * el banco. Ordenados por fecha desc + id para estabilidad cuando hay dos
 * movimientos el mismo día.
 */
export async function listBankMovementsForProject(
  projectId: string,
): Promise<BankMovementRow[]> {
  const supabase = await createClient();

  // No hay project_id en bank_movements — arrancamos por los bank_ids del
  // proyecto y filtramos ahí. Query separada en vez de join para simetría
  // con el resto del código y para que RLS no tenga que resolver joins.
  const { data: banksData } = await supabase
    .from("banks")
    .select("id")
    .eq("project_id", projectId);
  const bankIds = ((banksData ?? []) as Array<{ id: string }>).map((b) => b.id);
  if (bankIds.length === 0) return [];

  const { data } = await supabase
    .from("bank_movements")
    .select("*")
    .in("bank_id", bankIds)
    .order("occurred_at", { ascending: false })
    .order("created_at", { ascending: false });

  return (data ?? []) as unknown as BankMovementRow[];
}
