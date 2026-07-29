import { describe, expect, it } from "vitest";

import {
  inPeriod,
  lastMonths,
  overlapsPeriod,
  resolvePeriod,
} from "./period";

// `now` fijo para determinismo: miércoles 15 de julio de 2026, mediodía UTC.
// Elegido en medio de un mes para poder distinguir MTD vs mes completo.
const NOW = new Date("2026-07-15T12:00:00Z");

describe("resolvePeriod", () => {
  it("default: mes actual (MTD) — from = día 1, to = hoy", () => {
    const p = resolvePeriod({}, NOW);
    expect(p.key).toBe("mes-actual");
    expect(p.from.getMonth()).toBe(6); // julio (0-indexed)
    expect(p.from.getDate()).toBe(1);
    expect(p.to.getDate()).toBe(15);
    // Ventana ~15 días ÷ 30.44 = ~0.49 meses
    expect(p.monthsInWindow).toBeGreaterThan(0.4);
    expect(p.monthsInWindow).toBeLessThan(0.6);
  });

  it("mes-anterior: from = día 1, to = último día del mes previo", () => {
    const p = resolvePeriod({ range: "mes-anterior" }, NOW);
    expect(p.key).toBe("mes-anterior");
    expect(p.from.getMonth()).toBe(5); // junio
    expect(p.from.getDate()).toBe(1);
    expect(p.to.getMonth()).toBe(5); // junio
    expect(p.to.getDate()).toBe(30); // último día de junio
    expect(p.monthsInWindow).toBe(1);
  });

  it("90d: from = hoy − 89, to = hoy, ventana ~90 días ≈ 2.96 meses", () => {
    const p = resolvePeriod({ range: "90d" }, NOW);
    expect(p.key).toBe("90d");
    expect(p.monthsInWindow).toBeCloseTo(90 / 30.44, 3);
    const diffDays =
      (p.to.getTime() - p.from.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThan(89);
    expect(diffDays).toBeLessThan(91);
  });

  it("range desconocido cae al default (mes-actual) sin romper", () => {
    const p = resolvePeriod({ range: "algo-random" }, NOW);
    expect(p.key).toBe("mes-actual");
  });

  it("null/undefined también cae al default", () => {
    expect(resolvePeriod({ range: null }, NOW).key).toBe("mes-actual");
    expect(resolvePeriod(undefined, NOW).key).toBe("mes-actual");
  });
});

describe("inPeriod", () => {
  const period = resolvePeriod({}, NOW); // mes actual, 1..15 jul 2026

  it("fecha dentro del rango → true", () => {
    // Uso mediodía local para que no dependa de la TZ que corre Node.
    expect(inPeriod("2026-07-10T12:00:00", period)).toBe(true);
    expect(inPeriod("2026-07-01T12:00:00", period)).toBe(true);
  });

  it("fecha fuera → false", () => {
    // Mediodía del día previo/posterior al rango, TZ-safe.
    expect(inPeriod("2026-06-25T12:00:00", period)).toBe(false);
    expect(inPeriod("2026-07-20T12:00:00", period)).toBe(false);
  });

  it("null/vacío/inválido → false (ausente NO cuenta como dentro)", () => {
    expect(inPeriod(null, period)).toBe(false);
    expect(inPeriod(undefined, period)).toBe(false);
    expect(inPeriod("", period)).toBe(false);
    expect(inPeriod("not-a-date", period)).toBe(false);
  });
});

describe("overlapsPeriod", () => {
  const period = resolvePeriod({}, NOW); // 1..15 jul

  it("rango que se solapa completamente → true", () => {
    expect(
      overlapsPeriod("2026-07-05T12:00:00", "2026-07-10T12:00:00", period),
    ).toBe(true);
  });
  it("rango que empieza antes y termina dentro → true", () => {
    expect(
      overlapsPeriod("2026-06-25T12:00:00", "2026-07-05T12:00:00", period),
    ).toBe(true);
  });
  it("rango que empieza dentro y termina después → true", () => {
    expect(
      overlapsPeriod("2026-07-10T12:00:00", "2026-08-05T12:00:00", period),
    ).toBe(true);
  });
  it("rango completamente afuera → false", () => {
    expect(
      overlapsPeriod("2026-06-01T12:00:00", "2026-06-20T12:00:00", period),
    ).toBe(false);
    expect(
      overlapsPeriod("2026-08-01T12:00:00", "2026-08-20T12:00:00", period),
    ).toBe(false);
  });
  it("null en cualquiera de los dos → false", () => {
    expect(overlapsPeriod(null, "2026-07-10T12:00:00", period)).toBe(false);
    expect(overlapsPeriod("2026-07-05T12:00:00", null, period)).toBe(false);
  });
});

describe("lastMonths", () => {
  it("devuelve N buckets ordenados cronológicamente (viejo → nuevo)", () => {
    const bs = lastMonths(3, NOW);
    expect(bs.length).toBe(3);
    // El último bucket es el mes actual
    expect(bs[2]!.from.getMonth()).toBe(6);
    expect(bs[1]!.from.getMonth()).toBe(5);
    expect(bs[0]!.from.getMonth()).toBe(4);
  });

  it("el bucket más reciente se corta a `now` — nunca dibuja futuro", () => {
    const bs = lastMonths(1, NOW);
    // to del bucket = now, no fin de mes calendario
    expect(bs[0]!.to.getTime()).toBeLessThanOrEqual(NOW.getTime());
    expect(bs[0]!.to.getDate()).toBe(15);
  });

  it("bucket clave `YYYY-MM`", () => {
    const bs = lastMonths(2, NOW);
    expect(bs[1]!.key).toBe("2026-07");
    expect(bs[0]!.key).toBe("2026-06");
  });
});
