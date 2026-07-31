import { describe, expect, it } from "vitest";

import { translateTeamMemberError } from "./translate-error";

describe("translateTeamMemberError", () => {
  it("23503 con mención de sales → empuja a desactivar", () => {
    const out = translateTeamMemberError({
      code: "23503",
      message:
        'update or delete on table "team_members" violates foreign key constraint on table "sales"',
    });
    expect(out.toLowerCase()).toContain("desactiva");
    expect(out).toContain("histórico");
  });

  it("23503 con mención de payouts → empuja a desactivar", () => {
    const out = translateTeamMemberError({
      code: "23503",
      message:
        'update or delete on table "team_members" violates foreign key on table "team_member_payouts"',
    });
    expect(out.toLowerCase()).toContain("desactiva");
    expect(out).toContain("payouts");
  });

  it("23503 sin match específico → propaga detalle", () => {
    const out = translateTeamMemberError({
      code: "23503",
      message: "violates foreign key",
      details: "algún detalle",
    });
    expect(out).toContain("Referencia inválida");
  });

  it("código desconocido → propaga mensaje original", () => {
    const out = translateTeamMemberError({
      code: "42P01",
      message: 'relation "team_members" does not exist',
    });
    expect(out).toContain("does not exist");
  });

  it("sin código ni mensaje → fallback friendly", () => {
    const out = translateTeamMemberError({});
    expect(out).toContain("Error");
  });
});
