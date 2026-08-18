import { describe, expect, it } from "vitest";

import { translateExpenseError } from "./translate-error";

describe("translateExpenseError", () => {
  it("23514 con expenses_tax_within_gross → mensaje explícito de IVA", () => {
    const out = translateExpenseError({
      code: "23514",
      message:
        'new row for relation "expenses" violates check constraint "expenses_tax_within_gross"',
    });
    expect(out).toContain("IVA");
    expect(out).toContain("bruto");
  });

  it("23514 sin match específico → mensaje genérico sobre montos", () => {
    const out = translateExpenseError({
      code: "23514",
      message: "otro check violation",
    });
    expect(out).toContain("montos");
  });

  it("23514 details=expense-project-org-mismatch → mensaje sobre proyectos", () => {
    const out = translateExpenseError({
      code: "23514",
      message: "El proyecto no pertenece a la organización del gasto.",
      details: "expense-project-org-mismatch",
    });
    expect(out).toContain("otra organización");
  });

  it("23514 details=expense-project-not-found → pide recargar la lista", () => {
    const out = translateExpenseError({
      code: "23514",
      message: "El proyecto asociado no existe.",
      details: "expense-project-not-found",
    });
    expect(out).toContain("Recargá");
  });

  it("23503 sobre bank_movement_id → dice recargar", () => {
    // Puede pasar por carrera: alguien borró el bank_movement mientras el
    // form estaba abierto. El mensaje pide recargar en vez de exponer el
    // detalle técnico del FK.
    const out = translateExpenseError({
      code: "23503",
      message: 'insert or update on table "expenses" violates foreign key constraint "expenses_bank_movement_id_fkey"',
    });
    expect(out).toContain("movimiento");
    expect(out).toContain("Recargá");
  });

  it("código desconocido → propaga mensaje original (mejor técnico que silencio)", () => {
    const out = translateExpenseError({
      code: "42P01",
      message: 'relation "foo" does not exist',
    });
    expect(out).toContain("does not exist");
  });

  it("sin código ni mensaje → fallback genérico", () => {
    const out = translateExpenseError({});
    expect(out).toContain("Error");
  });
});
