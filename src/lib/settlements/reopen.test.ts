import { describe, expect, it, vi } from "vitest";

import { reopenLaunchSettlement } from "./reopen";

/**
 * Los tests de `reopenLaunchSettlement` cubren la capa de traducción del
 * error. La lógica de la RPC (guards, UPDATE, DELETE) se testea por
 * separado con smoke tests en Studio — no acá.
 *
 * Fake de supabase.rpc: función que devuelve un shape {data, error}
 * armado por cada test.
 */

function makeFake(rpcResponse: {
  data: unknown;
  error: null | { message: string; details?: string };
}) {
  const rpcSpy = vi.fn(async () => rpcResponse);
  return { supabase: { rpc: rpcSpy } as unknown as never, rpcSpy };
}

describe("reopenLaunchSettlement", () => {
  it("rechaza motivo vacío antes de tocar la RPC", async () => {
    const { supabase, rpcSpy } = makeFake({ data: null, error: null });

    const res = await reopenLaunchSettlement(supabase, {
      settlementId: "s-1",
      reason: "   ",
    });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("reopen-reason-required");
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it("mapea detail='settlement-not-found' al reason correcto", async () => {
    const { supabase } = makeFake({
      data: null,
      error: {
        message: "No existe la liquidación indicada.",
        details: "settlement-not-found",
      },
    });

    const res = await reopenLaunchSettlement(supabase, {
      settlementId: "missing",
      reason: "corrección",
    });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("settlement-not-found");
  });

  it("mapea detail='settlement-not-liquidada' cuando la RPC rebota por status", async () => {
    const { supabase } = makeFake({
      data: null,
      error: {
        message: "Solo se pueden reabrir liquidaciones en estado liquidada",
        details: "settlement-not-liquidada",
      },
    });

    const res = await reopenLaunchSettlement(supabase, {
      settlementId: "s-1",
      reason: "corrección",
    });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("settlement-not-liquidada");
  });

  it("mapea detail='settlement-has-bank-movements' cuando hay bm linkeados", async () => {
    const { supabase } = makeFake({
      data: null,
      error: {
        message: "La liquidación tiene movimientos bancarios linkeados",
        details: "settlement-has-bank-movements",
      },
    });

    const res = await reopenLaunchSettlement(supabase, {
      settlementId: "s-1",
      reason: "corrección",
    });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("settlement-has-bank-movements");
  });

  it("devuelve la fila cuando la RPC responde ok", async () => {
    const row = {
      id: "s-1",
      status: "abierta",
      closed_at: null,
      reopen_reason: "corrección",
    };
    const { supabase, rpcSpy } = makeFake({ data: row, error: null });

    const res = await reopenLaunchSettlement(supabase, {
      settlementId: "s-1",
      reason: "  corrección  ",
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.settlement.id).toBe("s-1");
    // La RPC recibió el motivo con trim aplicado.
    expect(rpcSpy).toHaveBeenCalledWith("reopen_launch_settlement", {
      p_settlement_id: "s-1",
      p_reason: "corrección",
    });
  });

  it("detail desconocido cae a reason='unknown'", async () => {
    const { supabase } = makeFake({
      data: null,
      error: { message: "algo raro", details: "unexpected-marker" },
    });

    const res = await reopenLaunchSettlement(supabase, {
      settlementId: "s-1",
      reason: "corrección",
    });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("unknown");
  });
});
