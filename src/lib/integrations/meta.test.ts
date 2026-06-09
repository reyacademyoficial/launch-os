import { describe, it, expect } from "vitest";

import emptyFixture from "./__fixtures__/meta/insights_empty.json";
import happyFixture from "./__fixtures__/meta/insights_happy.json";
import malformedFixture from "./__fixtures__/meta/error_malformed.json";
import rateLimitedFixture from "./__fixtures__/meta/error_rate_limited.json";
import tokenInvalidFixture from "./__fixtures__/meta/error_token_invalid.json";

import { isLeadActionType, parseMetaResponse } from "./meta";

/**
 * Tests del adapter de Meta. `parseMetaResponse` es la pieza que importa: el
 * `fetch` real solo lo invoca el orchestrator. Si parseMetaResponse maneja
 * los 5 fixtures correctamente, la integración está blindada contra todos
 * los caminos del brief.
 *
 * NOTA: estos fixtures se hicieron basados en la doc oficial de Meta (v25)
 * + convenciones del SDK. Cuando llegue la cuenta real de Elbio, dump del
 * response real va a reemplazar los fixtures si encuentro diferencias.
 */

const emptyHeaders = new Headers();

describe("meta.parseMetaResponse — happy path", () => {
  it("mapea cada día con spend/clicks/impressions/leads", () => {
    const result = parseMetaResponse(happyFixture, emptyHeaders, 200);
    expect(result.ok).toBe(true);
    if (!result.ok) return; // narrowing

    expect(result.rows).toHaveLength(2);

    const day1 = result.rows[0]!;
    expect(day1.date).toBe("2026-07-10");
    expect(day1.spend).toBe(120.45);
    expect(day1.impressions).toBe(15234);
    expect(day1.clicks).toBe(327);
    // Solo el action_type "lead" mapea; "link_click" y "page_engagement" no.
    expect(day1.leads).toBe(18);

    const day2 = result.rows[1]!;
    expect(day2.date).toBe("2026-07-11");
    // Suma de los dos action_types de leads del fixture: 12 + 4 = 16
    expect(day2.leads).toBe(16);
  });

  it("guarda el item crudo en raw para debug", () => {
    const result = parseMetaResponse(happyFixture, emptyHeaders, 200);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]!.raw).toMatchObject({ date_start: "2026-07-10" });
  });
});

describe("meta.parseMetaResponse — vacío", () => {
  it("data: [] devuelve success con rows vacío (no es error)", () => {
    const result = parseMetaResponse(emptyFixture, emptyHeaders, 200);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(0);
  });
});

describe("meta.parseMetaResponse — token inválido", () => {
  it("code 190 → kind=token_invalid", () => {
    const result = parseMetaResponse(tokenInvalidFixture, emptyHeaders, 400);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("token_invalid");
    expect(result.detail.code).toBe(190);
    expect(result.detail.error_subcode).toBe(463);
    expect(result.detail.fbtrace_id).toBe("AbCdEfGhIjK");
  });
});

describe("meta.parseMetaResponse — rate limit", () => {
  it("code 17 → kind=rate_limited", () => {
    const result = parseMetaResponse(rateLimitedFixture, emptyHeaders, 400);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("rate_limited");
    expect(result.detail.code).toBe(17);
  });

  it("parsea retryAfter desde X-Business-Use-Case-Usage cuando viene", () => {
    const headers = new Headers({
      "x-business-use-case-usage": JSON.stringify({
        // shape real de Meta: keyed por account id, valor array con un objeto
        "1234567890": [{ estimated_time_to_regain_access: 15 }],
      }),
    });
    const result = parseMetaResponse(rateLimitedFixture, headers, 400);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("rate_limited");
    // 15 minutos × 60 = 900 segundos
    expect(result.retryAfterSeconds).toBe(900);
  });

  it("retryAfter es null si el header no se puede parsear", () => {
    const result = parseMetaResponse(rateLimitedFixture, emptyHeaders, 400);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.retryAfterSeconds).toBeNull();
  });
});

describe("meta.parseMetaResponse — shape inesperado", () => {
  it("body sin data array ni error → kind=error con schema_mismatch", () => {
    const result = parseMetaResponse(malformedFixture, emptyHeaders, 200);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("error");
    expect(result.detail.cause).toBe("schema_mismatch");
  });

  it("body no-objeto → kind=error", () => {
    const result = parseMetaResponse("html error page", emptyHeaders, 502);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("error");
    expect(result.detail.cause).toBe("non_object_body");
  });

  it("HTTP 5xx sin error estructurado → kind=error con upstream_5xx", () => {
    const result = parseMetaResponse({}, emptyHeaders, 503);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("error");
    expect(result.detail.cause).toBe("upstream_5xx");
  });

  it("item de data[] sin date_start es saltado (no rompe los demás)", () => {
    const partial = {
      data: [
        { spend: "10.00", clicks: "5", actions: [] /* sin date_start */ },
        { spend: "20.00", clicks: "8", actions: [], date_start: "2026-08-01" },
      ],
    };
    const result = parseMetaResponse(partial, emptyHeaders, 200);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.date).toBe("2026-08-01");
  });

  it("todos los items malformados → kind=error (no success vacío)", () => {
    const allBad = {
      data: [{ spend: "10" }, { clicks: "5" }],
    };
    const result = parseMetaResponse(allBad, emptyHeaders, 200);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("error");
    expect(result.detail.cause).toBe("schema_mismatch");
  });
});

describe("meta.isLeadActionType — heurística (VALIDAR CON CUENTA REAL)", () => {
  it.each([
    ["lead", true],
    ["onsite_conversion.lead_grouped", true],
    ["offsite_conversion.fb_pixel_lead", true],
    ["leadgen.other", true],
    ["link_click", false],
    ["page_engagement", false],
    ["purchase", false],
  ])("%s → %s", (actionType, expected) => {
    expect(isLeadActionType(actionType)).toBe(expected);
  });
});
