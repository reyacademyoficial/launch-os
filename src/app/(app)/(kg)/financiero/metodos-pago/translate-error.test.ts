import { describe, expect, it } from "vitest";

import { translatePaymentMethodError } from "./translate-error";

describe("translatePaymentMethodError", () => {
  it("23505 → dice unique dentro de la org", () => {
    // Post 0134 el unique del schema es (organization_id, name).
    const out = translatePaymentMethodError({
      code: "23505",
      message: "duplicate key value violates unique constraint",
    });
    expect(out.toLowerCase()).toContain("ya existe");
    expect(out).toContain("Kingrow");
  });

  it("23503 con mención de payments → empuja a desactivar", () => {
    // El RESTRICT sobre payments.payment_method_id evita perder histórico.
    // El mensaje sugiere el toggle en vez del delete.
    const out = translatePaymentMethodError({
      code: "23503",
      message:
        'update or delete on table "payment_methods" violates foreign key constraint on table "payments"',
    });
    expect(out.toLowerCase()).toContain("desactiva");
    expect(out).toContain("histórico");
  });

  it("23503 sin mención de payments → propaga detalle", () => {
    const out = translatePaymentMethodError({
      code: "23503",
      message: "violates foreign key on some other table",
      details: "detalle técnico",
    });
    expect(out).toContain("Referencia inválida");
  });

  it("código desconocido → propaga mensaje original", () => {
    const out = translatePaymentMethodError({
      code: "42P01",
      message: 'relation "payment_methods" does not exist',
    });
    expect(out).toContain("does not exist");
  });

  it("sin código ni mensaje → fallback friendly", () => {
    const out = translatePaymentMethodError({});
    expect(out).toContain("Error");
  });
});
