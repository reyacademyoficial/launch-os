import { describe, expect, it } from "vitest";

import {
  translateCloseSettlementError,
  translateCreateSettlementError,
} from "./translate-error";

// ═══════════════════════════════════════════════════════════════════════════
// translateCreateSettlementError — cubre TODOS los reasons del orquestador
// (create.ts). Si mañana se agrega un nuevo `CreateSettlementFailReason`,
// TypeScript va a fallar el switch exhaustivo y este test tiene que
// actualizarse — no queremos que ningún reason quede sin copy.
// ═══════════════════════════════════════════════════════════════════════════

describe("translateCreateSettlementError", () => {
  it("launch-not-found → mensaje sobre el lanzamiento", () => {
    const out = translateCreateSettlementError("launch-not-found");
    expect(out).toContain("lanzamiento");
  });

  it("no-rule → menciona 'regla' y linkea a Reglas de split", () => {
    // El brief 6c-c pide explícitamente que este error linkee o al menos
    // mencione dónde configurar la regla. La UI puede además pegar un link
    // arriba, pero el copy tiene que ser autoexplicativo.
    const out = translateCreateSettlementError("no-rule");
    expect(out).toContain("regla");
    expect(out).toContain("Reglas de split");
  });

  it("no-payments → dice que no hay nada que liquidar", () => {
    const out = translateCreateSettlementError("no-payments");
    expect(out).toContain("pagos");
    expect(out).toContain("liquidar");
  });

  it("already-settled → menciona que las complementarias no están implementadas", () => {
    // Copy negociado en el brief: en Maratón G7 va a pasar en cuanto entre
    // uno de los ~$40M pendientes. El usuario tiene que entender POR QUÉ
    // ese pago no genera plata nueva en el tablero, no solo que "ya existe".
    const out = translateCreateSettlementError("already-settled");
    expect(out).toContain("cerrada");
    expect(out).toContain("complementaria");
    expect(out).toContain("todavía no están implementadas");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// translateCloseSettlementError — matchea por `details` porque es lo que la
// RPC controla explícitamente (via `raise ... using detail = ...`). El
// código SQLSTATE es informativo.
// ═══════════════════════════════════════════════════════════════════════════

describe("translateCloseSettlementError", () => {
  it("detail=closed-at-required → pide elegir fecha", () => {
    const out = translateCloseSettlementError({
      code: "23514",
      message: "La fecha de cierre es obligatoria.",
      details: "closed-at-required",
    });
    expect(out).toContain("fecha");
  });

  it("detail=settlement-not-open → dice que solo se cierran borradores", () => {
    // Este error puede aparecer por doble-click, o porque el settlement fue
    // cerrado por otro admin en simultáneo. El mensaje tiene que hacer
    // obvia la acción: recargar y revisar el estado.
    const out = translateCloseSettlementError({
      code: "23514",
      message: "Esta liquidación no está abierta.",
      details: "settlement-not-open",
    });
    expect(out).toContain("abierta");
    expect(out).toContain("borrador");
  });

  it("detail=settlement-not-found → mensaje sobre desaparición", () => {
    const out = translateCloseSettlementError({
      code: "P0002",
      message: "No existe la liquidación indicada.",
      details: "settlement-not-found",
    });
    expect(out).toContain("no existe");
  });

  it("detail desconocido → propaga message original (no lo traga)", () => {
    // Ver el mensaje técnico ayuda a debuggear una infra caída. Peor mensaje
    // silencioso que uno técnico.
    const out = translateCloseSettlementError({
      code: "08006",
      message: "connection to server was lost",
      details: null,
    });
    expect(out).toContain("connection");
  });

  it("sin details y sin message → fallback friendly", () => {
    const out = translateCloseSettlementError({});
    expect(out).toContain("Error");
  });
});
