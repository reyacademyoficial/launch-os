import { describe, expect, it } from "vitest";

import { translateAssetError } from "./translate-error";

describe("translateAssetError", () => {
  it("23514 con mensaje sobre asset_type → dice tipo inválido", () => {
    const out = translateAssetError({
      code: "23514",
      message:
        'new row violates check constraint "assets_asset_type_check" — asset_type not in list',
    });
    expect(out).toContain("tipo");
  });

  it("23514 genérico → mensaje sobre montos", () => {
    const out = translateAssetError({
      code: "23514",
      message: 'violates check constraint "assets_amount_check"',
    });
    expect(out).toContain("montos");
  });

  it("23503 → propaga detalle del FK inválido", () => {
    const out = translateAssetError({
      code: "23503",
      message: "violates foreign key constraint",
      details: 'Key (account_id)=(...) is not present in table "accounts"',
    });
    expect(out).toContain("Referencia inválida");
  });

  it("código desconocido → propaga el mensaje original", () => {
    const out = translateAssetError({
      code: "42P01",
      message: 'relation "assets" does not exist',
    });
    expect(out).toContain("does not exist");
  });

  it("sin código ni mensaje → fallback friendly", () => {
    const out = translateAssetError({});
    expect(out).toContain("Error");
  });
});
