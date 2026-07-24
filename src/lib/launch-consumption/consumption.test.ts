import { describe, it, expect } from "vitest";

import { buildHourSlots, parseHHMM, formatHHMM } from "./hours";
import { computeConsumptionMetrics } from "./metrics";
import { DEFAULT_CONSUMPTION_CONFIG, type ConsumptionCells } from "./types";

describe("buildHourSlots", () => {
  it("genera slots inclusivos con default 09:00-12:00/10min", () => {
    const slots = buildHourSlots(DEFAULT_CONSUMPTION_CONFIG);
    expect(slots[0]).toBe("09:00");
    expect(slots[slots.length - 1]).toBe("12:00");
    expect(slots).toHaveLength(19);
  });

  it("respeta intervalos que no dividen exactamente la ventana", () => {
    const slots = buildHourSlots({
      ...DEFAULT_CONSUMPTION_CONFIG,
      startTime: "09:00",
      endTime: "09:25",
      intervalMinutes: 10,
    });
    // 09:00, 09:10, 09:20 — 09:30 excede end.
    expect(slots).toEqual(["09:00", "09:10", "09:20"]);
  });

  it("devuelve vacío si end <= start o interval inválido", () => {
    expect(
      buildHourSlots({ ...DEFAULT_CONSUMPTION_CONFIG, endTime: "09:00" }),
    ).toEqual([]);
    expect(
      buildHourSlots({ ...DEFAULT_CONSUMPTION_CONFIG, intervalMinutes: 0 }),
    ).toEqual([]);
  });
});

describe("parseHHMM / formatHHMM", () => {
  it("roundtrip básico", () => {
    expect(formatHHMM(parseHHMM("09:30")!)).toBe("09:30");
    expect(formatHHMM(parseHHMM("00:00")!)).toBe("00:00");
    expect(formatHHMM(parseHHMM("23:59")!)).toBe("23:59");
  });

  it("rechaza entradas inválidas", () => {
    expect(parseHHMM("24:00")).toBeNull();
    expect(parseHHMM("9:60")).toBeNull();
    expect(parseHHMM("hola")).toBeNull();
  });
});

describe("computeConsumptionMetrics", () => {
  const config = {
    startTime: "09:00",
    endTime: "09:20",
    intervalMinutes: 10,
    classes: ["Clase 1", "Clase 2"],
  };

  it("suma totales por clase y detecta el pico", () => {
    const cells: ConsumptionCells = {
      "09:00": { "Clase 1": 10, "Clase 2": 5 },
      "09:10": { "Clase 1": 20, "Clase 2": 25 },
      "09:20": { "Clase 1": 4, "Clase 2": 6 },
    };
    const metrics = computeConsumptionMetrics(config, cells);

    expect(metrics.slotCount).toBe(3);
    expect(metrics.perClass).toEqual([
      { className: "Clase 1", total: 34, averagePerSlot: 34 / 3 },
      { className: "Clase 2", total: 36, averagePerSlot: 36 / 3 },
    ]);
    expect(metrics.peak).toEqual({ hour: "09:10", total: 45 });
  });

  it("celdas ausentes o inválidas se cuentan como 0 y peak es null si todo es 0", () => {
    const cells: ConsumptionCells = {
      "09:00": { "Clase 1": Number.NaN as unknown as number, "Clase 2": -3 },
    };
    const metrics = computeConsumptionMetrics(config, cells);
    expect(metrics.perClass.every((c) => c.total === 0)).toBe(true);
    expect(metrics.peak).toBeNull();
  });
});
