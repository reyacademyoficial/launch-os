import { describe, it, expect } from "vitest";

import {
  slugifyToKey,
  toValueColumns,
  validateCreateParameterInput,
  validateParameterKey,
  validateParameterLabel,
  validateParameterValue,
  type CreateParameterInput,
  type ParameterValueInput,
} from "./parameters-shared";

describe("academia/parameters — slugifyToKey", () => {
  it("normaliza nombres humanos a keys estables", () => {
    expect(slugifyToKey("Diagnóstico")).toBe("diagnostico");
    expect(slugifyToKey("Sesiones de coaching")).toBe("sesiones-de-coaching");
    expect(slugifyToKey("¿Terminó el módulo 1?")).toBe("termino-el-modulo-1");
    expect(slugifyToKey("  Con  espacios  ")).toBe("con-espacios");
    expect(slugifyToKey("Año 2026")).toBe("ano-2026");
  });

  it("colapsa símbolos y guiones", () => {
    expect(slugifyToKey("a --- b")).toBe("a-b");
    expect(slugifyToKey("!!!hola!!!")).toBe("hola");
    expect(slugifyToKey("a/b\\c.d")).toBe("a-b-c-d");
  });

  it("devuelve string vacío para inputs sin caracteres alfanuméricos", () => {
    expect(slugifyToKey("")).toBe("");
    expect(slugifyToKey("   ")).toBe("");
    expect(slugifyToKey("!!!")).toBe("");
  });

  it("trunca a 60 caracteres", () => {
    const long = "a".repeat(100);
    expect(slugifyToKey(long).length).toBeLessThanOrEqual(60);
  });
});

describe("academia/parameters — validateParameterKey", () => {
  it("acepta keys válidas", () => {
    expect(validateParameterKey("diagnostico")).toBeNull();
    expect(validateParameterKey("coaching_sessions")).toBeNull();
    expect(validateParameterKey("nps-30d")).toBeNull();
    expect(validateParameterKey("v2_ok")).toBeNull();
    expect(validateParameterKey("abc123")).toBeNull();
  });

  it("rechaza vacío / solo espacios", () => {
    expect(validateParameterKey("")).toMatch(/requerido/);
    expect(validateParameterKey("   ")).toMatch(/requerido/);
  });

  it("rechaza mayúsculas y espacios", () => {
    expect(validateParameterKey("Diagnostico")).toMatch(/minúsculas/);
    expect(validateParameterKey("dos palabras")).toMatch(/minúsculas/);
    expect(validateParameterKey("con.punto")).toMatch(/minúsculas/);
  });

  it("rechaza > 60 caracteres", () => {
    expect(validateParameterKey("a".repeat(61))).toMatch(/60/);
  });
});

describe("academia/parameters — validateParameterLabel", () => {
  it("acepta labels no vacías", () => {
    expect(validateParameterLabel("Diagnóstico hecho")).toBeNull();
    expect(validateParameterLabel("¿Terminó el módulo 1?")).toBeNull();
  });

  it("rechaza vacío", () => {
    expect(validateParameterLabel("")).toMatch(/requerido/);
    expect(validateParameterLabel("   ")).toMatch(/requerido/);
  });

  it("rechaza > 120 caracteres", () => {
    expect(validateParameterLabel("x".repeat(121))).toMatch(/120/);
  });
});

describe("academia/parameters — validateCreateParameterInput", () => {
  const base: CreateParameterInput = {
    course_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    key: "diag",
    label: "Diagnóstico",
    type: "boolean",
  };

  it("acepta un input completo válido", () => {
    expect(validateCreateParameterInput(base)).toBeNull();
    expect(
      validateCreateParameterInput({
        ...base,
        required: true,
        order_index: 3,
      }),
    ).toBeNull();
    expect(
      validateCreateParameterInput({ ...base, type: "integer" }),
    ).toBeNull();
  });

  it("rechaza course_id vacío", () => {
    expect(validateCreateParameterInput({ ...base, course_id: "" })).toMatch(
      /course_id/,
    );
  });

  it("rechaza type inválido (incluye el ex-tipo 'text')", () => {
    expect(
      validateCreateParameterInput({
        ...base,
        type: "float" as unknown as CreateParameterInput["type"],
      }),
    ).toMatch(/type/);
    expect(
      validateCreateParameterInput({
        ...base,
        type: "text" as unknown as CreateParameterInput["type"],
      }),
    ).toMatch(/type/);
  });

  it("rechaza order_index negativo o no entero", () => {
    expect(
      validateCreateParameterInput({ ...base, order_index: -1 }),
    ).toMatch(/order_index/);
    expect(
      validateCreateParameterInput({ ...base, order_index: 1.5 }),
    ).toMatch(/order_index/);
  });

  it("propaga error de key inválida", () => {
    expect(validateCreateParameterInput({ ...base, key: "" })).toMatch(
      /key/,
    );
    expect(
      validateCreateParameterInput({ ...base, key: "Con Mayus" }),
    ).toMatch(/minúsculas/);
  });

  it("propaga error de label vacío", () => {
    expect(validateCreateParameterInput({ ...base, label: "" })).toMatch(
      /label/,
    );
  });
});

describe("academia/parameters — validateParameterValue", () => {
  it("boolean acepta true/false y rechaza otros", () => {
    expect(validateParameterValue({ type: "boolean", value: true })).toBeNull();
    expect(validateParameterValue({ type: "boolean", value: false })).toBeNull();
    expect(
      validateParameterValue({
        type: "boolean",
        value: "true",
      } as unknown as ParameterValueInput),
    ).toMatch(/boolean/);
  });

  it("integer acepta enteros y rechaza floats/no-números", () => {
    expect(validateParameterValue({ type: "integer", value: 0 })).toBeNull();
    expect(validateParameterValue({ type: "integer", value: 42 })).toBeNull();
    expect(validateParameterValue({ type: "integer", value: -3 })).toBeNull();
    expect(
      validateParameterValue({ type: "integer", value: 1.5 }),
    ).toMatch(/entero/);
    expect(
      validateParameterValue({
        type: "integer",
        value: "5",
      } as unknown as ParameterValueInput),
    ).toMatch(/entero/);
  });
});

describe("academia/parameters — toValueColumns", () => {
  it("boolean llena solo value_bool", () => {
    expect(toValueColumns({ type: "boolean", value: true })).toEqual({
      value_bool: true,
      value_int: null,
      value_text: null,
    });
    expect(toValueColumns({ type: "boolean", value: false })).toEqual({
      value_bool: false,
      value_int: null,
      value_text: null,
    });
  });

  it("integer llena solo value_int", () => {
    expect(toValueColumns({ type: "integer", value: 7 })).toEqual({
      value_bool: null,
      value_int: 7,
      value_text: null,
    });
    // Cubre value=0 (edge del boolean falso — asegura no colisión)
    expect(toValueColumns({ type: "integer", value: 0 })).toEqual({
      value_bool: null,
      value_int: 0,
      value_text: null,
    });
  });

  it("los dos tipos son mutuamente excluyentes en el output (invariante)", () => {
    const inputs: readonly ParameterValueInput[] = [
      { type: "boolean", value: true },
      { type: "integer", value: 1 },
    ];
    for (const input of inputs) {
      const cols = toValueColumns(input);
      const nonNulls = [cols.value_bool, cols.value_int, cols.value_text].filter(
        (v) => v !== null,
      );
      expect(nonNulls).toHaveLength(1);
    }
  });
});
