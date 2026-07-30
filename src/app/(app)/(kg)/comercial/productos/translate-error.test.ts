import { describe, expect, it } from "vitest";

import { translateProductError } from "./translate-error";

describe("translateProductError", () => {
  it("23505 → dice unique dentro del proyecto", () => {
    const out = translateProductError({
      code: "23505",
      message: "duplicate key value violates unique constraint",
    });
    expect(out.toLowerCase()).toContain("ya existe");
    expect(out).toContain("proyecto");
  });

  it("23503 con mención de sales → empuja a desactivar", () => {
    const out = translateProductError({
      code: "23503",
      message:
        'update or delete on table "products" violates foreign key constraint on table "sales"',
    });
    expect(out.toLowerCase()).toContain("desactiva");
    expect(out).toContain("histórico");
  });

  it("23503 sin mención de sales → propaga detalle", () => {
    const out = translateProductError({
      code: "23503",
      message: "violates foreign key",
      details: "otro detalle",
    });
    expect(out).toContain("Referencia inválida");
  });

  it("código desconocido → propaga mensaje original", () => {
    const out = translateProductError({
      code: "42P01",
      message: 'relation "products" does not exist',
    });
    expect(out).toContain("does not exist");
  });

  it("sin código ni mensaje → fallback friendly", () => {
    const out = translateProductError({});
    expect(out).toContain("Error");
  });
});
