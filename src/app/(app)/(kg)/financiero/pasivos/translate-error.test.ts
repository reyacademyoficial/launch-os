import { describe, expect, it } from "vitest";

import { translateLiabilityError } from "./translate-error";

describe("translateLiabilityError", () => {
  it("23514 con mensaje sobre liability_type → dice tipo inválido", () => {
    const out = translateLiabilityError({
      code: "23514",
      message:
        'violates check constraint on liability_type — value not in list',
    });
    expect(out).toContain("tipo");
  });

  it("23514 genérico → mensaje sobre monto", () => {
    const out = translateLiabilityError({
      code: "23514",
      message: 'violates check constraint "liabilities_amount_check"',
    });
    expect(out).toContain("monto");
  });

  it("23503 → propaga detalle del FK inválido", () => {
    const out = translateLiabilityError({
      code: "23503",
      message: "violates foreign key",
      details: 'Key (account_id)=(...) is not present',
    });
    expect(out).toContain("Referencia inválida");
  });

  it("código desconocido → propaga el mensaje original", () => {
    const out = translateLiabilityError({
      code: "42P01",
      message: 'relation "liabilities" does not exist',
    });
    expect(out).toContain("does not exist");
  });

  it("sin código ni mensaje → fallback friendly", () => {
    const out = translateLiabilityError({});
    expect(out).toContain("Error");
  });
});
