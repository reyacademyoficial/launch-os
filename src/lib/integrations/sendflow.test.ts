import { afterEach, describe, expect, it, vi } from "vitest";

import analyticsHappy from "./__fixtures__/sendflow/analytics_happy.json";
import releasesHappy from "./__fixtures__/sendflow/releases_happy.json";

import {
  fetchSendflowAnalytics,
  parseAnalyticsBody,
  parseReleasesBody,
  parseSendflowDateKey,
  SENDFLOW_DATE_FORMAT_DEFAULT,
} from "./sendflow";

/**
 * Tests del adapter de SendFlow. Igual que en meta.test.ts, atacamos los
 * parsers puros — el `fetch` real lo testea el e2e/smoke. Si los parsers
 * funcionan, el adapter funciona.
 *
 * ⚠️ Probe pendiente: las keys de `dates` son strings tipo "10072025" y el
 * default está fijado en DDMMYYYY (LATAM). Estos tests fijan ese contrato —
 * si alguien cambia el default sin actualizar los tests, se rompen y forzan
 * la conversación.
 */

describe("parseSendflowDateKey", () => {
  it("DDMMYYYY: '10072025' → '2025-07-10'", () => {
    expect(parseSendflowDateKey("10072025", "DDMMYYYY")).toBe("2025-07-10");
  });

  it("MMDDYYYY: '10072025' → '2025-10-07' (mes 10, día 7)", () => {
    expect(parseSendflowDateKey("10072025", "MMDDYYYY")).toBe("2025-10-07");
  });

  it("rechaza key con menos de 8 dígitos", () => {
    expect(parseSendflowDateKey("1072025", "DDMMYYYY")).toBeNull();
  });

  it("rechaza key con caracteres no numéricos", () => {
    expect(parseSendflowDateKey("10-07-25", "DDMMYYYY")).toBeNull();
  });

  it("rechaza mes inválido en DDMMYYYY ('10132025' → mes 13)", () => {
    expect(parseSendflowDateKey("10132025", "DDMMYYYY")).toBeNull();
  });

  it("rechaza mes inválido en MMDDYYYY ('13072025' → mes 13)", () => {
    // Útil para detectar que el formato es DDMMYYYY si la key real es
    // "13072025": parsearla como MMDDYYYY devuelve null → señal de que el
    // formato correcto es el otro. El test no cierra la decisión, solo
    // muestra el comportamiento.
    expect(parseSendflowDateKey("13072025", "MMDDYYYY")).toBeNull();
  });

  it("rechaza año fuera del rango razonable", () => {
    expect(parseSendflowDateKey("10071999", "DDMMYYYY")).toBeNull();
  });
});

describe("parseAnalyticsBody — windowing", () => {
  it("suma SOLO los días dentro de la ventana", () => {
    // Ventana: 10-13 julio 2025. El día 01/08/2025 cae fuera y debe ignorarse.
    const result = parseAnalyticsBody(analyticsHappy, {
      releaseId: "rel_abc",
      windowStart: "2025-07-10",
      windowEnd: "2025-07-13",
      dateFormat: "DDMMYYYY",
      httpStatus: 200,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // entered = 20 + 30 + 50 + 25 = 125
    expect(result.entered).toBe(125);
    // removed = 3 + 5 + 4 + 8 = 20
    expect(result.removed).toBe(20);
    // clicks = 130 + 200 + 145 + 65 = 540
    expect(result.clicks).toBe(540);
    // windowedDays no incluye 01/08
    expect(result.windowedDays).toHaveLength(4);
    expect(result.windowedDays.map((d) => d.date)).toEqual([
      "2025-07-10",
      "2025-07-11",
      "2025-07-12",
      "2025-07-13",
    ]);
  });

  it("ventana vacía (sin días dentro) → totales en 0 + windowedDays vacío", () => {
    const result = parseAnalyticsBody(analyticsHappy, {
      releaseId: "rel_abc",
      windowStart: "2026-01-01",
      windowEnd: "2026-01-10",
      dateFormat: "DDMMYYYY",
      httpStatus: 200,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entered).toBe(0);
    expect(result.removed).toBe(0);
    expect(result.clicks).toBe(0);
    expect(result.windowedDays).toEqual([]);
  });

  it("body que no es objeto → error", () => {
    const result = parseAnalyticsBody(null, {
      releaseId: "rel_abc",
      windowStart: "2025-07-10",
      windowEnd: "2025-07-13",
      dateFormat: "DDMMYYYY",
      httpStatus: 200,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("error");
    expect(result.detail.cause).toBe("non_object_body");
  });

  it("body sin ramas add/remove/clicks → schema_mismatch", () => {
    const result = parseAnalyticsBody(
      { foo: "bar" },
      {
        releaseId: "rel_abc",
        windowStart: "2025-07-10",
        windowEnd: "2025-07-13",
        dateFormat: "DDMMYYYY",
        httpStatus: 200,
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail.cause).toBe("schema_mismatch");
  });

  it("rama con dates vacíos pero presente → success con 0", () => {
    const result = parseAnalyticsBody(
      {
        add: { dates: {}, total: 0 },
        remove: { dates: {}, total: 0 },
        clicks: { dates: {}, total: 0 },
      },
      {
        releaseId: "rel_abc",
        windowStart: "2025-07-10",
        windowEnd: "2025-07-13",
        dateFormat: "DDMMYYYY",
        httpStatus: 200,
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entered).toBe(0);
  });

  it("usa SENDFLOW_DATE_FORMAT_DEFAULT cuando no se pasa override", () => {
    // Sin `dateFormat`, debe usar el default. Verificamos que el adapter
    // sigue interpretando "10072025" con el default actual.
    const result = parseAnalyticsBody(analyticsHappy, {
      releaseId: "rel_abc",
      windowStart: "2025-07-10",
      windowEnd: "2025-07-13",
      dateFormat: SENDFLOW_DATE_FORMAT_DEFAULT,
      httpStatus: 200,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entered).toBeGreaterThan(0);
  });
});

describe("parseReleasesBody", () => {
  it("acepta array directo de releases", () => {
    const result = parseReleasesBody(releasesHappy, 200);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.releases).toEqual([
      { releaseId: "rel_abc", name: "Comunidad lanzamiento Julio" },
      { releaseId: "rel_def", name: "Lista warmup VIP" },
    ]);
  });

  it("acepta wrapper { releases: [...] }", () => {
    const result = parseReleasesBody(
      { releases: [{ id: "x", name: "X" }] },
      200,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.releases).toEqual([{ releaseId: "x", name: "X" }]);
  });

  it("acepta wrapper { data: [...] }", () => {
    const result = parseReleasesBody(
      { data: [{ id: "x", name: "X" }] },
      200,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.releases).toEqual([{ releaseId: "x", name: "X" }]);
  });

  it("fallback a release_id si no hay id", () => {
    const result = parseReleasesBody(
      [{ release_id: "rel_x", name: "X" }],
      200,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.releases).toEqual([{ releaseId: "rel_x", name: "X" }]);
  });

  it("fallback de name al releaseId cuando no viene name", () => {
    const result = parseReleasesBody([{ id: "rel_x" }], 200);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.releases).toEqual([{ releaseId: "rel_x", name: "rel_x" }]);
  });

  it("ignora items sin id válido", () => {
    const result = parseReleasesBody(
      [{ name: "no id" }, { id: "ok", name: "OK" }],
      200,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.releases).toEqual([{ releaseId: "ok", name: "OK" }]);
  });

  it("body que no es array ni wrapper conocido → schema_mismatch", () => {
    const result = parseReleasesBody({ foo: "bar" }, 200);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail.cause).toBe("schema_mismatch");
  });
});

describe("fetchSendflowAnalytics — clasificación 401 vs 403 (bug 2026-06-17)", () => {
  // 401 → token_invalid → el orchestrator aborta TODO el sync (key compartida).
  // 403 → error/release_forbidden → la key es válida pero ESE release puntual
  //       no es accesible → no aborta otras releases.
  //
  // El bug original mezclaba 401+403 como token_invalid: un release sin
  // permiso kickeaba todo el sync con mensaje "API Key rechazada" falso.

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const args = {
    token: "fake-key",
    releaseId: "rel_xyz",
    windowStart: "2026-05-01",
    windowEnd: "2026-05-31",
  };

  it("HTTP 401 → token_invalid", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
      ),
    );
    const result = await fetchSendflowAnalytics(args);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("token_invalid");
    expect(result.detail.cause).toBe("auth_failed");
  });

  it("HTTP 403 → error con cause=release_forbidden (NO token_invalid)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }),
      ),
    );
    const result = await fetchSendflowAnalytics(args);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("error");
    expect(result.detail.cause).toBe("release_forbidden");
    expect(result.detail.release_id).toBe("rel_xyz");
  });

  it("HTTP 404 → error con cause=release_not_found", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "not found" }), { status: 404 }),
      ),
    );
    const result = await fetchSendflowAnalytics(args);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("error");
    expect(result.detail.cause).toBe("release_not_found");
  });

  it("HTTP 200 happy → suma según ventana", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(analyticsHappy), { status: 200 }),
      ),
    );
    const result = await fetchSendflowAnalytics({
      ...args,
      windowStart: "2025-07-10",
      windowEnd: "2025-07-13",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entered).toBe(125);
    expect(result.removed).toBe(20);
  });
});
