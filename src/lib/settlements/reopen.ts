/**
 * Wrapper del RPC `reopen_launch_settlement` (0130) — misma frontera que
 * `closeLaunchSettlement`/`transferToClient`: server action llama a esto,
 * esto llama al RPC y traduce el shape del error de postgrest a algo
 * accionable.
 *
 * La RPC hace 4 guards + UPDATE + DELETE dentro del mismo cuerpo (todo
 * cuerpo de función es atómico en Postgres). Esta capa solo:
 *   - valida el motivo en el borde antes del round-trip,
 *   - llama a la RPC,
 *   - devuelve un discriminated union `{ok, id} | {error, reason}` con el
 *     `reason` extraído del `detail` de la RPC (matcha por marcador, no
 *     por SQLSTATE).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { LaunchSettlementRow } from "./types";

type AnySupabase = SupabaseClient<any, any, any>;

export type ReopenSettlementFailReason =
  | "reopen-reason-required"
  | "settlement-not-found"
  | "settlement-not-liquidada"
  | "settlement-has-bank-movements"
  | "unknown";

export type ReopenSettlementResult =
  | { ok: true; settlement: LaunchSettlementRow }
  | { ok: false; reason: ReopenSettlementFailReason; detail: string };

export interface ReopenSettlementInput {
  settlementId: string;
  reason: string;
}

export async function reopenLaunchSettlement(
  supabase: AnySupabase,
  input: ReopenSettlementInput,
): Promise<ReopenSettlementResult> {
  const trimmed = input.reason?.trim() ?? "";
  if (!trimmed) {
    return {
      ok: false,
      reason: "reopen-reason-required",
      detail: "Motivo vacío antes de llamar a la RPC.",
    };
  }

  const { data, error } = await supabase.rpc("reopen_launch_settlement", {
    p_settlement_id: input.settlementId,
    p_reason: trimmed,
  } as never);

  if (error) {
    const marker = extractDetail(error);
    return {
      ok: false,
      reason: matchReason(marker),
      detail: error.message ?? marker ?? "sin detalle",
    };
  }

  const row = data as LaunchSettlementRow | null;
  if (!row) {
    return {
      ok: false,
      reason: "unknown",
      detail: "La RPC devolvió null sin error.",
    };
  }

  return { ok: true, settlement: row };
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers de matching de errores — mismo estilo que translateCloseSettlementError
// ═══════════════════════════════════════════════════════════════════════════

interface RpcErrorLike {
  message?: string | null;
  details?: string | null;
}

function extractDetail(error: RpcErrorLike): string {
  return (error.details ?? "").trim();
}

function matchReason(marker: string): ReopenSettlementFailReason {
  switch (marker) {
    case "reopen-reason-required":
      return "reopen-reason-required";
    case "settlement-not-found":
      return "settlement-not-found";
    case "settlement-not-liquidada":
      return "settlement-not-liquidada";
    case "settlement-has-bank-movements":
      return "settlement-has-bank-movements";
    default:
      return "unknown";
  }
}
