import { describe, expect, it } from "vitest";

import { translateRotateRuleError } from "./translate-error";

describe("translateRotateRuleError", () => {
  it("23505 (unique_violation) → mensaje de carrera entendible", () => {
    // El unique parcial de settlement_rules (por scope activo) solo puede
    // violarse por concurrencia: dos usuarios editaron la misma regla y uno
    // llegó primero. El otro tiene que recargar. Ese mensaje NO puede ser
    // el críptico del driver de Postgres.
    const out = translateRotateRuleError({
      code: "23505",
      message:
        'duplicate key value violates unique constraint "settlement_rules_active_scope_uniq"',
    });
    expect(out).toContain("Otra persona modificó esta regla");
    expect(out).toContain("Recargá");
    // Y NO expone el detalle técnico del índice.
    expect(out).not.toContain("settlement_rules_active_scope_uniq");
  });

  it("23514 (check_violation) → propaga el mensaje friendly de la RPC", () => {
    // La RPC 0097 tira estos errores con mensaje en castellano. La UI los
    // muestra tal cual — no hay traducción secundaria.
    const message = "El proyecto no pertenece a la organización indicada";
    const out = translateRotateRuleError({ code: "23514", message });
    expect(out).toBe(message);
  });

  it("código desconocido → propaga el mensaje original", () => {
    // Preferimos un mensaje técnico visible antes que uno genérico que
    // esconda información útil al debugear.
    const out = translateRotateRuleError({
      code: "42P01",
      message: 'relation "foo" does not exist',
    });
    expect(out).toContain("does not exist");
  });

  it("sin código ni mensaje → fallback genérico", () => {
    const out = translateRotateRuleError({});
    expect(out).toContain("Error");
  });
});
