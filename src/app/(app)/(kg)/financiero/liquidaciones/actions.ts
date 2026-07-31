"use server";

import { revalidatePath } from "next/cache";

import {
  createSettlement,
  type LaunchSettlementInsert,
} from "@/lib/settlements/create";
import type { LaunchSettlementStatus } from "@/lib/settlements/types";
import { requireRole } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

import {
  translateCloseSettlementError,
  translateCreateSettlementError,
} from "./translate-error";

// ═══════════════════════════════════════════════════════════════════════════
// Preview de creación — dryRun, sin escritura
// ═══════════════════════════════════════════════════════════════════════════
//
// Reusa `createSettlement` en modo dryRun. No hay implementación alternativa
// del cálculo — el simulador y el commit tienen que mostrar los mismos
// números, y la única forma de garantizarlo es que llamen a la misma función.

export interface PreviewCreatePayload {
  readonly launchId: string;
}

export type PreviewCreateResult =
  | {
      ok: true;
      payload: LaunchSettlementInsert;
      draftsCount: number;
    }
  | { ok: false; error: string };

export async function previewCreateSettlement(
  input: PreviewCreatePayload,
): Promise<PreviewCreateResult> {
  await requireRole("superadmin");
  const supabase = await createClient();

  const result = await createSettlement(supabase, {
    launchId: input.launchId,
    dryRun: true,
  });

  if (!result.ok) {
    return { ok: false, error: translateCreateSettlementError(result.reason) };
  }

  return {
    ok: true,
    payload: result.payload,
    draftsCount: result.draftsCount,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Commit de creación — escribe en `abierta`
// ═══════════════════════════════════════════════════════════════════════════
//
// El caller (UI) tiene que haber corrido el preview antes y mostrado la
// confirmación al usuario. Este endpoint NO hace preview implícito para no
// esconder el paso: si vamos a escribir, el usuario ya vio los números.

export interface CommitCreatePayload {
  readonly launchId: string;
}

export type CommitCreateResult =
  | { ok: true; settlementId: string }
  | { ok: false; error: string };

export async function commitCreateSettlement(
  input: CommitCreatePayload,
): Promise<CommitCreateResult> {
  await requireRole("superadmin");
  const supabase = await createClient();

  const result = await createSettlement(supabase, {
    launchId: input.launchId,
    dryRun: false,
  });

  if (!result.ok) {
    return { ok: false, error: translateCreateSettlementError(result.reason) };
  }

  if (!result.settlementId) {
    return {
      ok: false,
      error: "La creación no devolvió un id de liquidación.",
    };
  }

  revalidatePath("/financiero/liquidaciones");
  return { ok: true, settlementId: result.settlementId };
}

// ═══════════════════════════════════════════════════════════════════════════
// Cierre — RPC atómica 0100 (abierta → liquidada + client_transfer opcional)
// ═══════════════════════════════════════════════════════════════════════════

export interface CloseSettlementPayload {
  readonly settlementId: string;
  /**
   * Fecha administrativa del cierre elegida por el usuario. La UI la muestra
   * arriba del campo con el mes en que va a impactar el ingreso — decisión
   * dejada pendiente en 6c y resuelta acá: el usuario elige, no hoy por
   * default. Formato ISO 8601 (`toISOString()` del <input type="date"> con
   * la hora normalizada al inicio del día en KG_TZ, o directamente
   * `new Date(ymd).toISOString()` desde el cliente).
   */
  readonly closedAt: string;
}

export type CloseSettlementResult =
  | { ok: true; settlementId: string; status: LaunchSettlementStatus }
  | { ok: false; error: string };

export async function closeLaunchSettlement(
  input: CloseSettlementPayload,
): Promise<CloseSettlementResult> {
  await requireRole("superadmin");

  if (!input.closedAt || Number.isNaN(new Date(input.closedAt).getTime())) {
    // Defensa en la UI antes de tocar DB. La RPC 0100 también lo enforza,
    // pero acá evitamos el round-trip.
    return { ok: false, error: "Elegí una fecha de cierre válida." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("close_launch_settlement", {
    p_launch_settlement_id: input.settlementId,
    p_closed_at: input.closedAt,
  } as never);

  if (error) {
    return { ok: false, error: translateCloseSettlementError(error) };
  }

  const closed = data as
    | { id: string; status: LaunchSettlementStatus }
    | null;
  if (!closed) {
    return {
      ok: false,
      error: "El cierre no devolvió una fila de liquidación.",
    };
  }

  revalidatePath("/financiero/liquidaciones");
  revalidatePath("/financiero");
  return { ok: true, settlementId: closed.id, status: closed.status };
}
