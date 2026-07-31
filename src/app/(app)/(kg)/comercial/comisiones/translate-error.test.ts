import { describe, expect, it } from "vitest";

import { translateCommissionError } from "./translate-error";

describe("translateCommissionError", () => {
  it("23505 → dice colisión de scope + sugiere editar", () => {
    // El trigger del pivot commission_rule_modalities emite este código
    // cuando dos reglas cubrirían el mismo (project, launch, product,
    // modality). El mensaje empuja a editar en vez de crear duplicado.
    const out = translateCommissionError({
      code: "23505",
      message: 'duplicate key value violates unique constraint "cm_uniq"',
    });
    expect(out.toLowerCase()).toContain("modalidades");
    expect(out).toContain("scope");
    expect(out.toLowerCase()).toContain("editá");
  });

  it("23503 → propaga detalle del FK inválido", () => {
    const out = translateCommissionError({
      code: "23503",
      message: "violates foreign key",
      details: "detalle específico",
    });
    expect(out).toContain("Referencia inválida");
  });

  it("código desconocido → propaga mensaje original", () => {
    const out = translateCommissionError({
      code: "42P01",
      message: 'relation "commission_rules" does not exist',
    });
    expect(out).toContain("does not exist");
  });

  it("sin código ni mensaje → fallback friendly", () => {
    const out = translateCommissionError({});
    expect(out).toContain("Error");
  });
});
