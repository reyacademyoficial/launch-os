import { describe, expect, it } from "vitest";

import { translateBankError } from "./translate-error";

describe("translateBankError", () => {
  it("23505 con mención de organization_id → dice unique por organización", () => {
    // Post 0101 el unique es (organization_id, name). Un intento de crear
    // "Mercado Pago" cuando ya existe cae acá.
    const out = translateBankError({
      code: "23505",
      message:
        'duplicate key value violates unique constraint "banks_organization_id_name_key"',
    });
    expect(out).toContain("organización");
    expect(out.toLowerCase()).toContain("ya existe");
  });

  it("23505 genérico → mensaje neutro sobre datos duplicados", () => {
    const out = translateBankError({
      code: "23505",
      message: "unique constraint violation",
    });
    expect(out).toContain("Ya existe");
  });

  it("23503 → propaga detalle del FK inválido", () => {
    const out = translateBankError({
      code: "23503",
      message: "violates foreign key",
      details: "Key (organization_id)=(...) is not present in table",
    });
    expect(out).toContain("Referencia inválida");
  });

  it("código desconocido → propaga mensaje original", () => {
    const out = translateBankError({
      code: "42P01",
      message: 'relation "banks" does not exist',
    });
    expect(out).toContain("does not exist");
  });

  it("sin código ni mensaje → fallback friendly", () => {
    const out = translateBankError({});
    expect(out).toContain("Error");
  });
});
