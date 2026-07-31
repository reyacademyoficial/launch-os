"use server";

import { revalidatePath } from "next/cache";

import type { LaunchSettlementStatus } from "@/lib/settlements/types";
import { requireRole } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

import { translateTransferError } from "./translate-error";

// ═══════════════════════════════════════════════════════════════════════════
// Server action para transfer_to_client (RPC 0102). Cierra el ciclo:
// dado un settlement liquidado con saldo pendiente + un banco propio, hace
// la transferencia atómica (bank_movement out + client_transfers transferido
// + status='transferida' del settlement).
// ═══════════════════════════════════════════════════════════════════════════

export type TransferToClientResult =
  | { ok: true; settlementId: string; status: LaunchSettlementStatus }
  | { ok: false; error: string };

export interface TransferToClientPayload {
  readonly settlementId: string;
  readonly bankId: string;
  /**
   * Fecha efectiva de la transferencia (ISO 8601 o YYYY-MM-DD). Si no
   * viene, la RPC usa `now()` como default. La UI la pide con un
   * <input type="date">.
   */
  readonly transferredAt?: string;
}

export async function transferToClient(
  input: TransferToClientPayload,
): Promise<TransferToClientResult> {
  await requireRole("superadmin");

  if (!input.settlementId || !input.bankId) {
    return { ok: false, error: "Faltan datos de la transferencia." };
  }

  const supabase = await createClient();
  const params: Record<string, string | null> = {
    p_launch_settlement_id: input.settlementId,
    p_bank_id: input.bankId,
  };
  if (input.transferredAt && input.transferredAt.length > 0) {
    // La RPC acepta timestamptz — un `YYYY-MM-DD` se interpreta al inicio
    // del día en TZ del server. Alcanza para la fecha efectiva.
    params.p_transferred_at = new Date(
      `${input.transferredAt}T00:00:00`,
    ).toISOString();
  }

  const { data, error } = await supabase.rpc(
    "transfer_to_client",
    params as never,
  );

  if (error) return { ok: false, error: translateTransferError(error) };

  const settlement = data as
    | { id: string; status: LaunchSettlementStatus }
    | null;
  if (!settlement) {
    return {
      ok: false,
      error: "La transferencia no devolvió una fila de liquidación.",
    };
  }

  revalidatePath("/financiero/transferencias");
  revalidatePath("/financiero/liquidaciones");
  revalidatePath("/financiero/movimientos");
  revalidatePath("/financiero/bancos");
  revalidatePath("/financiero");
  return {
    ok: true,
    settlementId: settlement.id,
    status: settlement.status,
  };
}
