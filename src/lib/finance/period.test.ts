import { describe, expect, it } from "vitest";

import {
  inPeriodDate,
  inPeriodTs,
  KG_TZ,
  lastMonths,
  overlapsPeriodDate,
  resolvePeriod,
  toCalendarYmd,
} from "./period";

// `now` fijo para determinismo: miércoles 15 de julio de 2026 a mediodía UTC.
// En AR (UTC−3) esto son las 09:00 del mismo 15 de julio → mismo día calendario.
// Elegido en medio de un mes para poder distinguir MTD vs mes completo.
const NOW = new Date("2026-07-15T12:00:00Z");

// ═══════════════════════════════════════════════════════════════════════════
// resolvePeriod
// ═══════════════════════════════════════════════════════════════════════════
describe("resolvePeriod", () => {
  it("default: mes actual (MTD) — from = día 1 AR, to = hoy AR", () => {
    const p = resolvePeriod({}, NOW);
    expect(p.key).toBe("mes-actual");
    expect(p.fromYmd).toBe("2026-07-01");
    expect(p.toYmd).toBe("2026-07-15");
    // 15 días ÷ 30.44 ≈ 0.49 meses
    expect(p.monthsInWindow).toBeGreaterThan(0.4);
    expect(p.monthsInWindow).toBeLessThan(0.6);
  });

  it("mes-anterior: from = día 1 mes anterior, to = último día del mes anterior", () => {
    const p = resolvePeriod({ range: "mes-anterior" }, NOW);
    expect(p.key).toBe("mes-anterior");
    expect(p.fromYmd).toBe("2026-06-01");
    expect(p.toYmd).toBe("2026-06-30");
    expect(p.monthsInWindow).toBe(1);
  });

  it("90d: from = hoy − 89 días calendario, to = hoy", () => {
    const p = resolvePeriod({ range: "90d" }, NOW);
    expect(p.key).toBe("90d");
    expect(p.toYmd).toBe("2026-07-15");
    // 89 días hacia atrás desde 15-jul: junio (30) + mayo restante = 15-jul − 89d = 17-abr
    expect(p.fromYmd).toBe("2026-04-17");
    expect(p.monthsInWindow).toBeCloseTo(90 / 30.44, 3);
  });

  it("range desconocido / null / undefined cae al default sin romper", () => {
    expect(resolvePeriod({ range: "algo-random" }, NOW).key).toBe("mes-actual");
    expect(resolvePeriod({ range: null }, NOW).key).toBe("mes-actual");
    expect(resolvePeriod(undefined, NOW).key).toBe("mes-actual");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Tests RESTAURADOS de la versión anterior. Antes fallaban en TZ negativa por
// mezclar `Date(y,m,d)` local con timestamps ISO. Con la semántica calendario
// en KG_TZ deben pasar en cualquier zona horaria del runner.
// ═══════════════════════════════════════════════════════════════════════════
describe("inPeriodDate — DATE, restaurados", () => {
  const period = resolvePeriod({}, NOW); // mes actual, 2026-07-01..15

  it("fecha dentro del rango → true", () => {
    expect(inPeriodDate("2026-07-10", period)).toBe(true);
    expect(inPeriodDate("2026-07-01", period)).toBe(true);
  });

  it("fecha fuera → false", () => {
    expect(inPeriodDate("2026-06-30", period)).toBe(false);
    expect(inPeriodDate("2026-07-16", period)).toBe(false);
  });

  it("null/vacío/inválido → false (ausente NO cuenta como dentro)", () => {
    expect(inPeriodDate(null, period)).toBe(false);
    expect(inPeriodDate(undefined, period)).toBe(false);
    expect(inPeriodDate("", period)).toBe(false);
    expect(inPeriodDate("not-a-date", period)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Nuevos bordes: los tres casos donde el bug de TZ se manifestaba
// ═══════════════════════════════════════════════════════════════════════════
describe("bordes de mes en KG_TZ (los que exponen el bug original)", () => {
  const julio = resolvePeriod({}, NOW); // mes-actual = julio 2026
  const junio = resolvePeriod({ range: "mes-anterior" }, NOW); // mes-anterior = junio 2026

  it("día 1 del mes cuenta como parte de ese mes", () => {
    // Antes fallaba: Date(2026,6,1) en AR-TZ = 2026-07-01T03Z, y "2026-07-01"
    // (date) parseaba como 2026-07-01T00Z → row anterior a period.from.
    expect(inPeriodDate("2026-07-01", julio)).toBe(true);
    // Simétrico para mes-anterior
    expect(inPeriodDate("2026-06-01", junio)).toBe(true);
  });

  it("último día del mes cuenta como parte de ese mes", () => {
    // Último día de junio bajo período junio
    expect(inPeriodDate("2026-06-30", junio)).toBe(true);
    // Y NO debe filtrarse en julio
    expect(inPeriodDate("2026-06-30", julio)).toBe(false);
  });

  it("timestamptz a las 23:30 hora AR del último día del mes cae en ese mes, no en el siguiente", () => {
    // 30-jun 23:30 AR (UTC−3) = 01-jul 02:30 UTC. Bajo la vieja implementación
    // este instante caía en JULIO (porque cruza medianoche UTC). Con conversión
    // a calendario KG_TZ cae correctamente en JUNIO.
    const ts = "2026-07-01T02:30:00Z";
    expect(inPeriodTs(ts, junio)).toBe(true);
    expect(inPeriodTs(ts, julio)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// inPeriodTs — chequeos adicionales de contrato
// ═══════════════════════════════════════════════════════════════════════════
describe("inPeriodTs — TIMESTAMPTZ", () => {
  const julio = resolvePeriod({}, NOW);

  it("timestamp en medio del mes actual → true", () => {
    expect(inPeriodTs("2026-07-10T15:00:00Z", julio)).toBe(true);
  });

  it("timestamp claramente fuera → false", () => {
    expect(inPeriodTs("2026-05-01T00:00:00Z", julio)).toBe(false);
    expect(inPeriodTs("2026-09-01T00:00:00Z", julio)).toBe(false);
  });

  it("null/inválido → false", () => {
    expect(inPeriodTs(null, julio)).toBe(false);
    expect(inPeriodTs("not-a-timestamp", julio)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// overlapsPeriodDate — restaurados
// ═══════════════════════════════════════════════════════════════════════════
describe("overlapsPeriodDate", () => {
  const period = resolvePeriod({}, NOW); // 1..15 jul

  it("rango que se solapa completamente → true", () => {
    expect(overlapsPeriodDate("2026-07-05", "2026-07-10", period)).toBe(true);
  });
  it("rango que empieza antes y termina dentro → true", () => {
    expect(overlapsPeriodDate("2026-06-25", "2026-07-05", period)).toBe(true);
  });
  it("rango que empieza dentro y termina después → true", () => {
    expect(overlapsPeriodDate("2026-07-10", "2026-08-05", period)).toBe(true);
  });
  it("rango completamente afuera → false", () => {
    expect(overlapsPeriodDate("2026-06-01", "2026-06-20", period)).toBe(false);
    expect(overlapsPeriodDate("2026-08-01", "2026-08-20", period)).toBe(false);
  });
  it("null en cualquiera de los dos → false", () => {
    expect(overlapsPeriodDate(null, "2026-07-10", period)).toBe(false);
    expect(overlapsPeriodDate("2026-07-05", null, period)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// lastMonths — buckets del sparkline
// ═══════════════════════════════════════════════════════════════════════════
describe("lastMonths", () => {
  it("devuelve N buckets ordenados cronológicamente con from/toYmd en KG_TZ", () => {
    const bs = lastMonths(3, NOW);
    expect(bs.length).toBe(3);
    expect(bs[0]!.key).toBe("2026-05");
    expect(bs[1]!.key).toBe("2026-06");
    expect(bs[2]!.key).toBe("2026-07");
  });

  it("bucket del mes actual se corta a hoy — nunca dibuja futuro", () => {
    const bs = lastMonths(1, NOW);
    expect(bs[0]!.fromYmd).toBe("2026-07-01");
    expect(bs[0]!.toYmd).toBe("2026-07-15");
  });

  it("buckets pasados llegan al último día calendario", () => {
    const bs = lastMonths(2, NOW);
    expect(bs[0]!.fromYmd).toBe("2026-06-01");
    expect(bs[0]!.toYmd).toBe("2026-06-30");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// KG_TZ / toCalendarYmd — sanity
// ═══════════════════════════════════════════════════════════════════════════
describe("KG_TZ constant + toCalendarYmd", () => {
  it("la zona vive en una única constante", () => {
    expect(KG_TZ).toBe("America/Argentina/Buenos_Aires");
  });

  it("toCalendarYmd devuelve el día CALENDARIO en KG_TZ, no en UTC", () => {
    // 01-jul 02:30 UTC = 30-jun 23:30 AR
    expect(toCalendarYmd(new Date("2026-07-01T02:30:00Z"))).toBe("2026-06-30");
    // Mediodía UTC = 09:00 AR → mismo día en ambas
    expect(toCalendarYmd(new Date("2026-07-15T12:00:00Z"))).toBe("2026-07-15");
  });
});
