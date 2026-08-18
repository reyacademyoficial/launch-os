"use server";

import { revalidatePath } from "next/cache";

import type { LaunchSettlementStatus } from "@/lib/settlements/types";
import { requireRole } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

import { translateTransferError } from "./translate-error";

/**
 * Roles del bridge `client_transfer_bank_movements` (mig 0129). Igual que
 * en facturas/gastos/nómina. Una transferencia a cliente puede tener:
 *   principal → el movimiento OUT del banco que salió (creado por la RPC
 *               transfer_to_client, ya linkeado vía FK col vieja +
 *               backfilleado al bridge).
 *   comision  → fee bancario/pasarela cobrado al hacer la transferencia
 *               (Wise, transferencia internacional, etc.). El humano lo
 *               agrega manualmente después de conciliar la salida.
 *   otro      → ajustes.
 */
export type TransferMovementRole = "principal" | "comision" | "otro";

export type LinkTransferResult = { ok: true } | { error: string };

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

// ═══════════════════════════════════════════════════════════════════════════
// linkTransferToMovement — vincula un bank_movement al bridge de la
// transferencia (mig 0129). Uso típico: registrar la comisión bancaria del
// giro después de que la RPC transfer_to_client ya creó el principal.
// ═══════════════════════════════════════════════════════════════════════════
//
// Guards:
//   - Misma organización (RLS también lo bloquearía).
//   - role='principal' requiere kind='out'.
//   - role='comision' u 'otro' aceptan cualquier kind.

export async function linkTransferToMovement(
  clientTransferId: string,
  bankMovementId: string,
  role: TransferMovementRole = "comision",
): Promise<LinkTransferResult> {
  await requireRole("superadmin");

  if (!clientTransferId || !bankMovementId) {
    return { error: "Falta client_transfer_id o bank_movement_id." };
  }

  const supabase = await createClient();

  const [{ data: ctRow }, { data: bmRow }] = await Promise.all([
    supabase
      .from("client_transfers")
      .select("id, organization_id")
      .eq("id", clientTransferId)
      .maybeSingle(),
    supabase
      .from("bank_movements")
      .select("id, kind, organization_id")
      .eq("id", bankMovementId)
      .maybeSingle(),
  ]);
  const ct = ctRow as { id: string; organization_id: string } | null;
  const bm = bmRow as
    | { id: string; kind: "in" | "out"; organization_id: string }
    | null;
  if (!ct) return { error: "La transferencia ya no existe o no tenés acceso." };
  if (!bm) return { error: "El movimiento ya no existe o no tenés acceso." };
  if (ct.organization_id !== bm.organization_id) {
    return { error: "Transferencia y movimiento son de organizaciones distintas." };
  }
  if (role === "principal" && bm.kind !== "out") {
    return {
      error:
        "El movimiento 'principal' de una transferencia tiene que ser una SALIDA. Elegí role='comision' u 'otro' para entradas.",
    };
  }

  const { error } = await supabase
    .from("client_transfer_bank_movements")
    .insert({
      client_transfer_id: clientTransferId,
      bank_movement_id: bankMovementId,
      role,
    } as never);

  if (error) {
    if (error.code === "23505") {
      return { error: "Ese movimiento ya está vinculado a esta transferencia." };
    }
    return { error: error.message };
  }

  revalidatePath("/financiero/transferencias");
  revalidatePath("/financiero/movimientos");
  revalidatePath("/financiero/bancos");
  revalidatePath("/financiero");
  return { ok: true };
}

export async function unlinkTransferFromMovement(
  clientTransferId: string,
  bankMovementId: string,
): Promise<LinkTransferResult> {
  await requireRole("superadmin");

  if (!clientTransferId || !bankMovementId) {
    return { error: "Falta client_transfer_id o bank_movement_id." };
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from("client_transfer_bank_movements")
    .delete()
    .eq("client_transfer_id", clientTransferId)
    .eq("bank_movement_id", bankMovementId);

  if (error) return { error: error.message };

  revalidatePath("/financiero/transferencias");
  revalidatePath("/financiero/movimientos");
  revalidatePath("/financiero/bancos");
  revalidatePath("/financiero");
  return { ok: true };
}
