import { describe, expect, it } from "vitest";

import { translateTransferError } from "./translate-error";

describe("translateTransferError", () => {
  it("detail=settlement-not-found → dice recargar", () => {
    const out = translateTransferError({
      code: "P0002",
      message: "No existe la liquidación indicada.",
      details: "settlement-not-found",
    });
    expect(out.toLowerCase()).toContain("no existe");
    expect(out.toLowerCase()).toContain("recargá");
  });

  it("detail=settlement-not-liquidada → empuja a cerrar primero", () => {
    // Este caso aparece si alguien intenta transferir sobre un settlement
    // en 'abierta' (borrador). El copy dirige al módulo correcto.
    const out = translateTransferError({
      code: "23514",
      message: "Esta liquidación no está en estado liquidada.",
      details: "settlement-not-liquidada",
    });
    expect(out).toContain("liquidada");
    expect(out.toLowerCase()).toContain("cerrala");
  });

  it("detail=project-not-external → dice que no aplica", () => {
    // Un settlement de proyecto propio (Rey Academy) no genera
    // client_transfers, no tiene sentido transferir.
    const out = translateTransferError({
      code: "23514",
      message:
        "La liquidación es de un proyecto propio, no requiere transferencia.",
      details: "project-not-external",
    });
    expect(out).toContain("propio");
  });

  it("detail=no-pending-balance → dice saldo cero", () => {
    // Caso típico: intentar transferir dos veces sobre el mismo settlement.
    // La segunda cae acá porque la primera dejó el pendiente en 0.
    const out = translateTransferError({
      code: "23514",
      message: "No hay saldo pendiente de transferir para esta liquidación.",
      details: "no-pending-balance",
    });
    expect(out).toContain("saldo pendiente");
  });

  it("detail=bank-not-found → dice recargar", () => {
    const out = translateTransferError({
      code: "P0002",
      message: "El banco elegido no existe.",
      details: "bank-not-found",
    });
    expect(out).toContain("banco");
    expect(out.toLowerCase()).toContain("recargá");
  });

  it("detail=bank-org-mismatch → dice organización", () => {
    // Guard cross-tenant: alguien manipuló el bank_id desde el cliente para
    // apuntar a un banco de otra org. RLS ya lo bloquearía, este mensaje
    // aparece si de alguna forma pasa.
    const out = translateTransferError({
      code: "23514",
      message: "El banco elegido no pertenece a la organización del settlement.",
      details: "bank-org-mismatch",
    });
    expect(out).toContain("organización");
  });

  it("detail desconocido → propaga mensaje original", () => {
    // Mejor mensaje técnico que silencio si aparece un caso nuevo.
    const out = translateTransferError({
      code: "08006",
      message: "connection to server was lost",
      details: null,
    });
    expect(out).toContain("connection");
  });

  it("sin código ni mensaje → fallback friendly", () => {
    const out = translateTransferError({});
    expect(out).toContain("Error");
  });
});
