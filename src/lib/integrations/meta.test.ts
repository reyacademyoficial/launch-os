import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import emptyFixture from "./__fixtures__/meta/insights_empty.json";
import happyFixture from "./__fixtures__/meta/insights_happy.json";
import malformedFixture from "./__fixtures__/meta/error_malformed.json";
import rateLimitedFixture from "./__fixtures__/meta/error_rate_limited.json";
import tokenInvalidFixture from "./__fixtures__/meta/error_token_invalid.json";

import {
  fetchMetaInsights,
  isLeadActionType,
  mapFieldData,
  parseLeadsBody,
  parseMetaResponse,
} from "./meta";

/**
 * Tests del adapter de Meta. `parseMetaResponse` es el parser puro (un
 * response); `fetchMetaInsights` es el wrapper que sigue paginación. Los
 * tests cubren los dos por separado.
 *
 * El fixture happy ya refleja la realidad observada en el dump de Fase A:
 * cada bloque de `actions[]` viene duplicado (Meta lo repite). El conteo
 * de leads usa SOLO `action_type === "lead"` y deduplica los repetidos.
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
    // El bloque viene duplicado: hay 2 entradas `lead=18`. Después del dedup,
    // leads = 18 (no 36 que sería sumar la duplicación).
    expect(day1.leads).toBe(18);

    const day2 = result.rows[1]!;
    expect(day2.date).toBe("2026-07-11");
    // Día 2 trae `lead=16` + `onsite_conversion.lead_grouped=12` +
    // `offsite_conversion.fb_pixel_lead=4` (12+4=16 — relación verificada en
    // el dump real). Solo cuenta `lead` → 16, no 16+12+4=32.
    expect(day2.leads).toBe(16);
  });

  it("guarda el item crudo en raw para debug", () => {
    const result = parseMetaResponse(happyFixture, emptyHeaders, 200);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]!.raw).toMatchObject({ date_start: "2026-07-10" });
  });
});

describe("meta.parseMetaResponse — dedup de actions", () => {
  it("dedup colapsa bloques duplicados idénticos (no suma)", () => {
    // Caso real observado: Meta repite el bloque de `actions[]` dentro de
    // la misma fila. Sumar daría doble cuenta.
    const item = {
      data: [
        {
          spend: "10",
          impressions: "100",
          clicks: "10",
          actions: [
            { action_type: "lead", value: "5" },
            { action_type: "lead", value: "5" },
          ],
          date_start: "2026-08-01",
          date_stop: "2026-08-01",
        },
      ],
    };
    const result = parseMetaResponse(item, emptyHeaders, 200);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]!.leads).toBe(5);
  });

  it("ignora otros action_types de lead (solo cuenta `lead`)", () => {
    // `lead_grouped`, `fb_pixel_lead`, `onsite_web_lead` son el mismo lead
    // bajo otra surface — sumarlos = doble cuenta. Solo `lead` es la verdad.
    const item = {
      data: [
        {
          spend: "10",
          impressions: "100",
          clicks: "10",
          actions: [
            { action_type: "lead", value: "74" },
            { action_type: "onsite_conversion.lead_grouped", value: "30" },
            { action_type: "offsite_conversion.fb_pixel_lead", value: "20" },
            { action_type: "onsite_web_lead", value: "24" },
            { action_type: "leadgen.other", value: "10" },
          ],
          date_start: "2026-08-01",
          date_stop: "2026-08-01",
        },
      ],
    };
    const result = parseMetaResponse(item, emptyHeaders, 200);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]!.leads).toBe(74);
  });

  it("aborta con dup_value_mismatch si el mismo type trae valores distintos", () => {
    // Si Meta devuelve dos veces el mismo type con valores distintos, no es
    // duplicación: es un desglose que no entendemos. Frenar > contar mal.
    const item = {
      data: [
        {
          spend: "10",
          actions: [
            { action_type: "lead", value: "5" },
            { action_type: "lead", value: "7" },
          ],
          date_start: "2026-08-01",
          date_stop: "2026-08-01",
        },
      ],
    };
    const result = parseMetaResponse(item, emptyHeaders, 200);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("error");
    expect(result.detail.cause).toBe("actions_dup_value_mismatch");
    expect(result.detail.action_type).toBe("lead");
    expect(result.detail.values).toEqual([5, 7]);
  });

  it("sin actions[] (item sin conversiones) → leads = 0", () => {
    const item = {
      data: [
        {
          spend: "10",
          impressions: "100",
          clicks: "10",
          date_start: "2026-08-01",
          date_stop: "2026-08-01",
        },
      ],
    };
    const result = parseMetaResponse(item, emptyHeaders, 200);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]!.leads).toBe(0);
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

describe("meta.isLeadActionType — solo `lead`", () => {
  // Validado contra dump real: `lead` es la fuente de la verdad; los otros
  // types son el mismo lead bajo otra surface (= doble cuenta si se suman).
  it.each([
    ["lead", true],
    ["onsite_conversion.lead_grouped", false],
    ["offsite_conversion.fb_pixel_lead", false],
    ["onsite_web_lead", false],
    ["leadgen.other", false],
    ["link_click", false],
    ["page_engagement", false],
    ["purchase", false],
  ])("%s → %s", (actionType, expected) => {
    expect(isLeadActionType(actionType)).toBe(expected);
  });
});

describe("meta.fetchMetaInsights — paginación", () => {
  const baseArgs = {
    token: "TEST_TOKEN",
    adAccountId: "act_999",
    campaignIds: ["c1"],
    since: "2026-07-01",
    until: "2026-07-03",
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  it("manda action_attribution_windows=7d_click en la primera URL", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: [] }));

    await fetchMetaInsights(baseArgs);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledWith = fetchSpy.mock.calls[0]![0] as string;
    expect(calledWith).toContain("action_attribution_windows=");
    expect(calledWith).toContain("7d_click");
    expect(calledWith).toContain("use_unified_attribution_setting=false");
  });

  it("sigue paging.next hasta agotar y concatena los rows", async () => {
    const page1 = {
      data: [
        {
          date_start: "2026-07-01",
          date_stop: "2026-07-01",
          spend: "10",
          impressions: "100",
          clicks: "10",
          actions: [{ action_type: "lead", value: "3" }],
        },
      ],
      paging: { next: "https://graph.facebook.com/v25.0/PAGE_2" },
    };
    const page2 = {
      data: [
        {
          date_start: "2026-07-02",
          date_stop: "2026-07-02",
          spend: "20",
          impressions: "200",
          clicks: "20",
          actions: [{ action_type: "lead", value: "5" }],
        },
      ],
      paging: { next: "https://graph.facebook.com/v25.0/PAGE_3" },
    };
    const page3 = {
      data: [
        {
          date_start: "2026-07-03",
          date_stop: "2026-07-03",
          spend: "30",
          impressions: "300",
          clicks: "30",
          actions: [{ action_type: "lead", value: "7" }],
        },
      ],
      // sin paging.next → loop termina
    };

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(page1))
      .mockResolvedValueOnce(jsonResponse(page2))
      .mockResolvedValueOnce(jsonResponse(page3));

    const result = await fetchMetaInsights(baseArgs);

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(fetchSpy.mock.calls[1]![0]).toBe(
      "https://graph.facebook.com/v25.0/PAGE_2",
    );
    expect(fetchSpy.mock.calls[2]![0]).toBe(
      "https://graph.facebook.com/v25.0/PAGE_3",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(3);
    expect(result.rows.map((r) => r.leads)).toEqual([3, 5, 7]);
  });

  it("propaga error de Meta en una página posterior (no escribe parcial)", async () => {
    const page1 = {
      data: [
        {
          date_start: "2026-07-01",
          date_stop: "2026-07-01",
          spend: "10",
          impressions: "100",
          clicks: "10",
          actions: [{ action_type: "lead", value: "3" }],
        },
      ],
      paging: { next: "https://graph.facebook.com/v25.0/PAGE_2" },
    };
    const tokenInvalidPage = {
      error: {
        message: "Session expired",
        code: 190,
        error_subcode: 463,
        fbtrace_id: "tracePage2",
      },
    };

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(page1))
      .mockResolvedValueOnce(jsonResponse(tokenInvalidPage));

    const result = await fetchMetaInsights(baseArgs);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("token_invalid");
  });
});

describe("meta.mapFieldData — Lead Ads", () => {
  it("mapea el shape real del dump (Fase C Paso 1)", () => {
    // Tomado tal cual del dump real que llegó del cliente.
    const fieldData = [
      { name: "email", values: ["castilloabrilsilvana@gmail.com"] },
      {
        name: "¿eres_dueño_de_carnicería?",
        values: ["sí,_soy_dueño_de_carnicería"],
      },
      { name: "phone_number", values: ["+526692286027"] },
      { name: "first_name", values: ["Isaac"] },
    ];
    const result = mapFieldData(fieldData);
    expect(result.email).toBe("castilloabrilsilvana@gmail.com");
    expect(result.rawPhone).toBe("+526692286027");
    expect(result.name).toBe("Isaac");
    expect(result.customFields).toEqual({
      "¿eres_dueño_de_carnicería?": "sí,_soy_dueño_de_carnicería",
    });
  });

  it("lowercase + trim del email aunque venga raro", () => {
    const result = mapFieldData([
      { name: "email", values: ["  CAMILA@Foo.COM  "] },
    ]);
    expect(result.email).toBe("camila@foo.com");
  });

  it("combina first_name + last_name a name", () => {
    const result = mapFieldData([
      { name: "first_name", values: ["Isaac"] },
      { name: "last_name", values: ["Silvana"] },
    ]);
    expect(result.name).toBe("Isaac Silvana");
  });

  it("full_name gana sobre first_name + last_name", () => {
    const result = mapFieldData([
      { name: "first_name", values: ["Isaac"] },
      { name: "last_name", values: ["Silvana"] },
      { name: "full_name", values: ["Isaac Castillo Silvana"] },
    ]);
    expect(result.name).toBe("Isaac Castillo Silvana");
  });

  it("tolera variantes castellanas (nombre, apellido, telefono, correo)", () => {
    const result = mapFieldData([
      { name: "nombre", values: ["Juan"] },
      { name: "apellido", values: ["Pérez"] },
      { name: "correo", values: ["juan@example.com"] },
      { name: "telefono", values: ["+5491112345678"] },
    ]);
    expect(result.name).toBe("Juan Pérez");
    expect(result.email).toBe("juan@example.com");
    expect(result.rawPhone).toBe("+5491112345678");
  });

  it("whatsapp como key cuenta como teléfono", () => {
    const result = mapFieldData([
      { name: "whatsapp", values: ["+5491111111111"] },
    ]);
    expect(result.rawPhone).toBe("+5491111111111");
  });

  it("campos desconocidos van a customFields con la key original", () => {
    const result = mapFieldData([
      { name: "first_name", values: ["X"] },
      { name: "¿cuanto_vendes_por_mes?", values: ["$50k"] },
      { name: "experiencia", values: ["+5 años"] },
    ]);
    expect(result.customFields).toEqual({
      "¿cuanto_vendes_por_mes?": "$50k",
      experiencia: "+5 años",
    });
  });

  it("values vacío o sin string skippea ese campo", () => {
    const result = mapFieldData([
      { name: "email", values: [] },
      { name: "phone_number", values: [null] },
      { name: "first_name", values: ["Isaac"] },
    ]);
    expect(result.email).toBeNull();
    expect(result.rawPhone).toBeNull();
    expect(result.name).toBe("Isaac");
  });

  it("input no-array → todos null y custom vacío (defensa)", () => {
    expect(mapFieldData(null)).toEqual({
      name: null,
      email: null,
      rawPhone: null,
      customFields: {},
    });
    expect(mapFieldData("not an array")).toEqual({
      name: null,
      email: null,
      rawPhone: null,
      customFields: {},
    });
  });
});

describe("meta.parseLeadsBody — Lead Ads", () => {
  it("parsea el body real del endpoint /{ad_id}/leads", () => {
    // Tomado tal cual del dump real que llegó del cliente.
    const body = {
      data: [
        {
          id: "989778150114487",
          ad_id: "120245106008850610",
          ad_name: "AD 009 [FLYER]",
          form_id: "2090788781467261",
          adset_id: "120245106008720610",
          field_data: [
            { name: "email", values: ["castilloabrilsilvana@gmail.com"] },
            { name: "phone_number", values: ["+526692286027"] },
            { name: "first_name", values: ["Isaac"] },
          ],
          campaign_id: "120245106008730610",
          created_time: "2026-06-01T23:23:41+0000",
          campaign_name: "[L7] México",
        },
      ],
      paging: { next: "https://graph.facebook.com/next" },
    };
    const rows = parseLeadsBody(body);
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.leadgenId).toBe("989778150114487");
    expect(r.createdTime).toBe("2026-06-01T23:23:41+0000");
    expect(r.formId).toBe("2090788781467261");
    expect(r.adId).toBe("120245106008850610");
    expect(r.adName).toBe("AD 009 [FLYER]");
    expect(r.campaignId).toBe("120245106008730610");
    expect(r.name).toBe("Isaac");
    expect(r.email).toBe("castilloabrilsilvana@gmail.com");
    expect(r.rawPhone).toBe("+526692286027");
  });

  it("item sin id se salta sin romper los demás", () => {
    const body = {
      data: [
        {
          /* sin id */
          created_time: "2026-06-01T00:00:00+0000",
          field_data: [{ name: "email", values: ["a@a.com"] }],
        },
        {
          id: "OK1",
          created_time: "2026-06-01T00:00:00+0000",
          field_data: [{ name: "email", values: ["b@b.com"] }],
        },
      ],
    };
    const rows = parseLeadsBody(body);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.leadgenId).toBe("OK1");
    expect(rows[0]!.email).toBe("b@b.com");
  });

  it("body sin data array → rows vacío (no tira)", () => {
    expect(parseLeadsBody({})).toEqual([]);
    expect(parseLeadsBody(null)).toEqual([]);
    expect(parseLeadsBody("not json")).toEqual([]);
  });
});
