import { describe, expect, it } from "vitest";

import {
  applyValueMap,
  normalizeEnumLabel,
  parseDateStart,
  parsePeople,
  parseRichText,
  parseSelect,
  parseTitle,
} from "./property-parser";

// Fixtures aproximados a lo que devuelve la API v1 de Notion.
const pageProps = {
  Name: {
    id: "title",
    type: "title",
    title: [
      { plain_text: "Rediseño del " },
      { plain_text: "roadmap" },
    ],
  },
  EmptyTitle: {
    id: "et",
    type: "title",
    title: [{ plain_text: "   " }],
  },
  Description: {
    id: "d",
    type: "rich_text",
    rich_text: [
      { plain_text: "Descripción larga\ncon salto" },
    ],
  },
  EmptyDescription: {
    id: "ed",
    type: "rich_text",
    rich_text: [],
  },
  Status: {
    id: "s",
    type: "select",
    select: { name: "In progress" },
  },
  StatusEmpty: {
    id: "se",
    type: "select",
    select: null,
  },
  StatusNative: {
    id: "sn",
    type: "status",
    status: { name: "Done" },
  },
  Assignee: {
    id: "a",
    type: "people",
    people: [{ id: "user-1" }, { id: "user-2" }, { }],
  },
  Due: {
    id: "du",
    type: "date",
    date: { start: "2026-08-30", end: null },
  },
  DueWithTime: {
    id: "dut",
    type: "date",
    date: { start: "2026-08-30T14:30:00.000Z", end: null },
  },
  DueEmpty: {
    id: "de",
    type: "date",
    date: null,
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// parseTitle
// ═══════════════════════════════════════════════════════════════════════════

describe("parseTitle", () => {
  it("concatena los segments plain_text del array", () => {
    expect(parseTitle(pageProps, "Name")).toBe("Rediseño del roadmap");
  });

  it("devuelve null si el título es solo whitespace", () => {
    // Un title vacío en Notion (page sin nombre) llega como array con
    // segments vacíos. Devolver null forza al caller a rechazar la fila
    // o usar un fallback — un internal_project con name='' rompe NOT NULL.
    expect(parseTitle(pageProps, "EmptyTitle")).toBeNull();
  });

  it("devuelve null si la propiedad no existe", () => {
    expect(parseTitle(pageProps, "NoExiste")).toBeNull();
  });

  it("devuelve null si el type no es 'title'", () => {
    // Defensivo: Notion permite renombrar/cambiar type de props. Si el
    // usuario configuró 'Name' pero después cambió el tipo en Notion, el
    // parser rebota al null en vez de romper.
    expect(parseTitle(pageProps, "Description")).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// parseRichText
// ═══════════════════════════════════════════════════════════════════════════

describe("parseRichText", () => {
  it("devuelve texto concatenado con saltos preservados", () => {
    expect(parseRichText(pageProps, "Description")).toBe(
      "Descripción larga\ncon salto",
    );
  });

  it("devuelve null si el array está vacío", () => {
    expect(parseRichText(pageProps, "EmptyDescription")).toBeNull();
  });

  it("devuelve null si el type no matchea", () => {
    expect(parseRichText(pageProps, "Name")).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// parseSelect — soporta type='select' Y type='status'
// ═══════════════════════════════════════════════════════════════════════════

describe("parseSelect", () => {
  it("extrae name de una prop type='select'", () => {
    expect(parseSelect(pageProps, "Status")).toBe("In progress");
  });

  it("extrae name de una prop type='status' (tipo especial de Notion)", () => {
    // Notion agregó type='status' como distinto de 'select' — misma UI para
    // el usuario pero shape diferente en el API. El parser soporta ambos
    // detrás del mismo helper para que el mapping no tenga que saber cuál es.
    expect(parseSelect(pageProps, "StatusNative")).toBe("Done");
  });

  it("devuelve null si la opción está vacía", () => {
    expect(parseSelect(pageProps, "StatusEmpty")).toBeNull();
  });

  it("devuelve null si la prop no existe", () => {
    expect(parseSelect(pageProps, "NoExiste")).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// parsePeople
// ═══════════════════════════════════════════════════════════════════════════

describe("parsePeople", () => {
  it("devuelve array de user ids", () => {
    // Descarta users sin id (defensivo — no debería pasar pero mejor
    // filtrar que meter undefined en el array).
    expect(parsePeople(pageProps, "Assignee")).toEqual(["user-1", "user-2"]);
  });

  it("devuelve array vacío si la prop no existe", () => {
    expect(parsePeople(pageProps, "NoExiste")).toEqual([]);
  });

  it("devuelve array vacío si el type no matchea", () => {
    expect(parsePeople(pageProps, "Status")).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// parseDateStart
// ═══════════════════════════════════════════════════════════════════════════

describe("parseDateStart", () => {
  it("devuelve YMD para una fecha simple", () => {
    expect(parseDateStart(pageProps, "Due")).toBe("2026-08-30");
  });

  it("hace slice del ISO 8601 para dates con hora — YMD sin TZ", () => {
    // "2026-08-30T14:30:00.000Z" en UTC. slice(0,10) devuelve el YMD del
    // ISO, no del calendario local — es el criterio conservador (evita
    // corrimientos de un día por TZ) y matchea cómo Notion serializa.
    expect(parseDateStart(pageProps, "DueWithTime")).toBe("2026-08-30");
  });

  it("devuelve null si el date es null (prop sin fecha)", () => {
    expect(parseDateStart(pageProps, "DueEmpty")).toBeNull();
  });

  it("devuelve null si la prop no existe", () => {
    expect(parseDateStart(pageProps, "NoExiste")).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// applyValueMap
// ═══════════════════════════════════════════════════════════════════════════

describe("applyValueMap", () => {
  const statusMap = {
    "Not started": "sin_empezar",
    "In progress": "en_proceso",
    Done: "listo",
  };
  const allowed = [
    "sin_empezar",
    "en_proceso",
    "bloqueado",
    "alerta_maxima",
    "listo",
  ] as const;

  it("devuelve el mapeo explícito cuando el valor está en el mapa", () => {
    expect(applyValueMap("In progress", statusMap, "sin_empezar")).toBe(
      "en_proceso",
    );
  });

  it("devuelve el fallback cuando el valor no está en el mapa y no hay allowed", () => {
    // Sin lista de allowed values no puede auto-match — cae al fallback.
    expect(applyValueMap("Paused", statusMap, "sin_empezar")).toBe(
      "sin_empezar",
    );
  });

  it("devuelve el fallback cuando el valor es null", () => {
    expect(applyValueMap(null, statusMap, "sin_empezar")).toBe("sin_empezar");
  });

  it("es case-sensitive en el map explícito — 'in progress' cae al auto-match", () => {
    // El map lookup es case-sensitive (Notion es case-sensitive). Con
    // allowed activo, "in progress" normaliza a "in_progress" que NO está
    // en el enum → fallback. Con "En proceso" en cambio sí matchearía.
    expect(applyValueMap("in progress", statusMap, "sin_empezar", allowed)).toBe(
      "sin_empezar",
    );
  });

  // ── Auto-normalización ─────────────────────────────────────────────────

  it("auto-match: 'Sin empezar' Notion → 'sin_empezar' KG sin mapping explícito", () => {
    // Escenario típico: operador no llenó el mapping form porque los
    // labels de Notion ya matchean el enum KG. No necesita configurar.
    expect(applyValueMap("Sin empezar", {}, "sin_empezar", allowed)).toBe(
      "sin_empezar",
    );
  });

  it("auto-match: 'Alerta máxima' con tilde → 'alerta_maxima'", () => {
    // Tildes y capitalización se normalizan. Notion permite emojis y
    // otros caracteres — los ignoramos, solo importa la palabra base.
    expect(applyValueMap("Alerta máxima", {}, "sin_empezar", allowed)).toBe(
      "alerta_maxima",
    );
  });

  it("auto-match: prioridad 'Alta' → 'alta'", () => {
    expect(applyValueMap("Alta", {}, "media", ["alta", "media", "baja"])).toBe(
      "alta",
    );
  });

  it("map explícito gana sobre auto-match", () => {
    // Si el operador mapeó "Bloqueado" → "alerta_maxima" a mano, respetamos
    // el override aunque "Bloqueado" auto-normalizaría a "bloqueado".
    expect(
      applyValueMap("Bloqueado", { Bloqueado: "alerta_maxima" }, "sin_empezar", allowed),
    ).toBe("alerta_maxima");
  });

  it("fallback cuando ni map explícito ni auto-match resuelven", () => {
    // "Custom X" no está en map ni en enum — cae al fallback.
    expect(applyValueMap("Custom X", {}, "sin_empezar", allowed)).toBe(
      "sin_empezar",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// normalizeEnumLabel
// ═══════════════════════════════════════════════════════════════════════════

describe("normalizeEnumLabel", () => {
  it("lowercase + snake_case + strip tildes", () => {
    expect(normalizeEnumLabel("Sin Empezar")).toBe("sin_empezar");
    expect(normalizeEnumLabel("Alerta Máxima")).toBe("alerta_maxima");
    expect(normalizeEnumLabel("EN PROCESO")).toBe("en_proceso");
  });

  it("colapsa múltiples espacios y trimea bordes", () => {
    expect(normalizeEnumLabel("   sin  empezar  ")).toBe("sin_empezar");
  });
});
