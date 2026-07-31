import { describe, expect, it } from "vitest";

import { translatePayoutError } from "./translate-error";

describe("translatePayoutError", () => {
  it("23503 con mención de team_member_id → dice recargar", () => {
    const out = translatePayoutError({
      code: "23503",
      message: 'violates foreign key on team_member_id',
    });
    expect(out).toContain("miembro");
    expect(out).toContain("Recargá");
  });

  it("23503 con mención de launch_id → dice recargar", () => {
    const out = translatePayoutError({
      code: "23503",
      message: 'violates foreign key on launch_id',
    });
    expect(out).toContain("lanzamiento");
    expect(out).toContain("Recargá");
  });

  it("23503 sin match específico → propaga detalle", () => {
    const out = translatePayoutError({
      code: "23503",
      message: "violates foreign key",
      details: "detalle",
    });
    expect(out).toContain("Referencia inválida");
  });

  it("23514 → mensaje sobre monto", () => {
    const out = translatePayoutError({
      code: "23514",
      message: 'violates check constraint',
    });
    expect(out).toContain("monto");
  });

  it("código desconocido → propaga mensaje original", () => {
    const out = translatePayoutError({
      code: "42P01",
      message: 'relation "team_member_payouts" does not exist',
    });
    expect(out).toContain("does not exist");
  });

  it("sin código ni mensaje → fallback friendly", () => {
    const out = translatePayoutError({});
    expect(out).toContain("Error");
  });
});
