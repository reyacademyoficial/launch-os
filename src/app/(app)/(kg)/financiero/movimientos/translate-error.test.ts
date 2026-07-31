import { describe, expect, it } from "vitest";

import { translateBankMovementError } from "./translate-error";

describe("translateBankMovementError", () => {
  it("23514 con amount → dice mayor a 0", () => {
    const out = translateBankMovementError({
      code: "23514",
      message: 'violates check constraint "bank_movements_amount_check"',
    });
    expect(out).toContain("mayor a 0");
  });

  it("23514 con kind → dice entrada o salida", () => {
    const out = translateBankMovementError({
      code: "23514",
      message: 'violates check constraint "bank_movements_kind_check"',
    });
    expect(out).toContain("entrada");
    expect(out).toContain("salida");
  });

  it("23503 con bank_id → dice recargar", () => {
    const out = translateBankMovementError({
      code: "23503",
      message: 'violates foreign key constraint on bank_id',
    });
    expect(out).toContain("banco");
    expect(out).toContain("Recargá");
  });

  it("código desconocido → propaga mensaje original", () => {
    const out = translateBankMovementError({
      code: "42P01",
      message: 'relation "bank_movements" does not exist',
    });
    expect(out).toContain("does not exist");
  });

  it("sin código ni mensaje → fallback friendly", () => {
    const out = translateBankMovementError({});
    expect(out).toContain("Error");
  });
});
