import { describe, expect, it } from "vitest";

import { fCount, fDateShort, fMoney, fMoneyK, fMonths, fPct } from "./format";

describe("fMoney", () => {
  it("formatea con locale es-AR", () => {
    expect(fMoney(1234567)).toBe("$1.234.567");
  });
  it("redondea a entero", () => {
    expect(fMoney(1000.75)).toBe("$1.001");
  });
  it("preserva el signo", () => {
    expect(fMoney(-1500)).toBe("-$1.500");
  });
  it("null/undefined/NaN → em-dash (no cero)", () => {
    expect(fMoney(null)).toBe("—");
    expect(fMoney(undefined)).toBe("—");
    expect(fMoney(Number.NaN)).toBe("—");
    expect(fMoney(Number.POSITIVE_INFINITY)).toBe("—");
  });
  it("cero explícito NO es lo mismo que ausente", () => {
    expect(fMoney(0)).toBe("$0");
  });
});

describe("fMoneyK — compacto", () => {
  it("K/M/B según el umbral", () => {
    expect(fMoneyK(950)).toBe("$950");
    expect(fMoneyK(1500)).toBe("$1,5K");
    expect(fMoneyK(1_500_000)).toBe("$1,5M");
    expect(fMoneyK(2_100_000_000)).toBe("$2,1B");
  });
  it("preserva signo", () => {
    expect(fMoneyK(-2500)).toBe("-$2,5K");
  });
  it("null/undefined/NaN → em-dash", () => {
    expect(fMoneyK(null)).toBe("—");
    expect(fMoneyK(Number.NaN)).toBe("—");
  });
});

describe("fPct", () => {
  it("entrada [0,1] → % con 1 decimal", () => {
    expect(fPct(0.853)).toBe("85,3%");
    expect(fPct(0)).toBe("0%");
    expect(fPct(1)).toBe("100%");
  });
  it("null/NaN → em-dash", () => {
    expect(fPct(null)).toBe("—");
    expect(fPct(Number.NaN)).toBe("—");
  });
});

describe("fMonths — runway", () => {
  it("null (burn=0) → infinito", () => {
    expect(fMonths(null)).toBe("∞");
  });
  it("undefined/NaN → em-dash", () => {
    expect(fMonths(undefined)).toBe("—");
    expect(fMonths(Number.NaN)).toBe("—");
  });
  it("cero o negativo → 0 meses", () => {
    expect(fMonths(0)).toBe("0 meses");
    expect(fMonths(-3)).toBe("0 meses");
  });
  it("menos de 24 meses en meses", () => {
    expect(fMonths(6)).toBe("6 meses");
    expect(fMonths(18.5)).toBe("18,5 meses");
  });
  it(">= 24 meses en años", () => {
    expect(fMonths(24)).toBe("2 años");
    expect(fMonths(36)).toBe("3 años");
  });
});

describe("fCount", () => {
  it("enteros con separador de miles", () => {
    expect(fCount(1234)).toBe("1.234");
  });
  it("null/NaN → em-dash", () => {
    expect(fCount(null)).toBe("—");
    expect(fCount(Number.NaN)).toBe("—");
  });
});

describe("fDateShort", () => {
  it("formatea día + mes corto", () => {
    // 2026-07-29 → "29 jul." o "29 jul" según la variante del ICU
    const out = fDateShort("2026-07-29T12:00:00Z");
    expect(out).toMatch(/^29 jul/i);
  });
  it("null/inválido → em-dash", () => {
    expect(fDateShort(null)).toBe("—");
    expect(fDateShort("not-a-date")).toBe("—");
  });
});
