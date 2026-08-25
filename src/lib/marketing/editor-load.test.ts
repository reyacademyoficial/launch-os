import { describe, expect, it } from "vitest";

import {
  addDaysYmd,
  computeEditorLoadByWeek,
  countAvailableDaysInRange,
  enumerateWeekStarts,
  isoWeekLabel,
  mondayOf,
  takeDatePart,
} from "./editor-load";

describe("takeDatePart", () => {
  it("extrae yyyy-mm-dd de un ISO ts", () => {
    expect(takeDatePart("2026-08-24T14:30:00Z")).toBe("2026-08-24");
  });
  it("acepta yyyy-mm-dd tal cual", () => {
    expect(takeDatePart("2026-08-24")).toBe("2026-08-24");
  });
  it("devuelve null en formatos inválidos", () => {
    expect(takeDatePart("")).toBe(null);
    expect(takeDatePart(null)).toBe(null);
    expect(takeDatePart("hoy")).toBe(null);
  });
});

describe("mondayOf", () => {
  it("un lunes se devuelve a sí mismo", () => {
    // 2026-08-24 es lunes
    expect(mondayOf("2026-08-24")).toBe("2026-08-24");
  });
  it("un miércoles vuelve al lunes anterior", () => {
    // 2026-08-26 es miércoles
    expect(mondayOf("2026-08-26")).toBe("2026-08-24");
  });
  it("un domingo vuelve al lunes 6 días atrás", () => {
    // 2026-08-30 es domingo
    expect(mondayOf("2026-08-30")).toBe("2026-08-24");
  });
  it("cruza cambio de mes", () => {
    // 2026-09-01 es martes → lunes 2026-08-31
    expect(mondayOf("2026-09-01")).toBe("2026-08-31");
  });
});

describe("addDaysYmd", () => {
  it("sumar 7 días avanza una semana", () => {
    expect(addDaysYmd("2026-08-24", 7)).toBe("2026-08-31");
  });
  it("restar 1 día cruza mes", () => {
    expect(addDaysYmd("2026-09-01", -1)).toBe("2026-08-31");
  });
});

describe("enumerateWeekStarts", () => {
  it("un rango de 3 semanas devuelve 3 lunes consecutivos", () => {
    const ws = enumerateWeekStarts("2026-08-24", "2026-09-08");
    // lunes 24-ago, 31-ago, 7-sep
    expect(ws).toEqual(["2026-08-24", "2026-08-31", "2026-09-07"]);
  });
  it("since y until en la misma semana devuelven 1 lunes", () => {
    // martes → jueves de la misma semana
    const ws = enumerateWeekStarts("2026-08-25", "2026-08-27");
    expect(ws).toEqual(["2026-08-24"]);
  });
});

describe("isoWeekLabel", () => {
  it("2026-08-24 es la semana ISO 35 de 2026", () => {
    expect(isoWeekLabel("2026-08-24")).toBe("2026-W35");
  });
  it("2026-01-05 (lunes) es la semana 2 de 2026", () => {
    expect(isoWeekLabel("2026-01-05")).toBe("2026-W02");
  });
});

describe("countAvailableDaysInRange", () => {
  it("una fila available=true que cubre todo el rango → 7", () => {
    const n = countAvailableDaysInRange(
      [{ personId: "p1", dateFrom: "2026-08-01", dateTo: "2026-08-31", available: true }],
      "2026-08-24",
      "2026-08-30",
    );
    expect(n).toBe(7);
  });
  it("sin filas → 0", () => {
    expect(
      countAvailableDaysInRange([], "2026-08-24", "2026-08-30"),
    ).toBe(0);
  });
  it("licencia corta sobrescribe disponibilidad amplia", () => {
    // Disponible todo agosto, pero de licencia 24-26 → quedan 4 días
    const n = countAvailableDaysInRange(
      [
        { personId: "p1", dateFrom: "2026-08-01", dateTo: "2026-08-31", available: true },
        { personId: "p1", dateFrom: "2026-08-24", dateTo: "2026-08-26", available: false },
      ],
      "2026-08-24",
      "2026-08-30",
    );
    expect(n).toBe(4);
  });
  it("rango parcialmente cubierto — solo cuenta los días dentro", () => {
    const n = countAvailableDaysInRange(
      [{ personId: "p1", dateFrom: "2026-08-27", dateTo: "2026-09-05", available: true }],
      "2026-08-24",
      "2026-08-30",
    );
    // 27, 28, 29, 30 = 4 días
    expect(n).toBe(4);
  });
});

describe("computeEditorLoadByWeek", () => {
  it("cuenta assets asignados por semana y persona", () => {
    const cells = computeEditorLoadByWeek(
      [
        { editorPersonId: "p1", bucketDate: "2026-08-25" }, // sem 08-24
        { editorPersonId: "p1", bucketDate: "2026-08-26" }, // sem 08-24
        { editorPersonId: "p1", bucketDate: "2026-09-02" }, // sem 08-31
        { editorPersonId: "p2", bucketDate: "2026-08-25" }, // sem 08-24
      ],
      [
        { personId: "p1", dateFrom: "2026-08-01", dateTo: "2026-09-30", available: true },
      ],
      "2026-08-24",
      "2026-09-06",
      ["p1", "p2"],
    );

    const p1w1 = cells.find((c) => c.personId === "p1" && c.weekStart === "2026-08-24");
    const p1w2 = cells.find((c) => c.personId === "p1" && c.weekStart === "2026-08-31");
    const p2w1 = cells.find((c) => c.personId === "p2" && c.weekStart === "2026-08-24");
    expect(p1w1?.assignedAssets).toBe(2);
    expect(p1w1?.availableDays).toBe(7);
    expect(p1w2?.assignedAssets).toBe(1);
    expect(p2w1?.assignedAssets).toBe(1);
    expect(p2w1?.availableDays).toBe(0); // p2 no tiene availability rows
  });

  it("marca overloaded cuando hay assets asignados y 0 días disponibles", () => {
    const cells = computeEditorLoadByWeek(
      [{ editorPersonId: "p1", bucketDate: "2026-08-25" }],
      // Sin availability para p1
      [],
      "2026-08-24",
      "2026-08-30",
      ["p1"],
    );
    expect(cells[0]).toMatchObject({
      personId: "p1",
      weekStart: "2026-08-24",
      assignedAssets: 1,
      availableDays: 0,
      overloaded: true,
    });
  });

  it("assets fuera del rango no cuentan", () => {
    const cells = computeEditorLoadByWeek(
      [
        { editorPersonId: "p1", bucketDate: "2026-07-01" }, // antes del rango
        { editorPersonId: "p1", bucketDate: "2026-10-01" }, // después
      ],
      [
        { personId: "p1", dateFrom: "2026-01-01", dateTo: "2026-12-31", available: true },
      ],
      "2026-08-24",
      "2026-08-30",
      ["p1"],
    );
    expect(cells.every((c) => c.assignedAssets === 0)).toBe(true);
  });

  it("bucketDate en formato ISO ts es aceptado", () => {
    const cells = computeEditorLoadByWeek(
      [{ editorPersonId: "p1", bucketDate: "2026-08-25T18:00:00Z" }],
      [
        { personId: "p1", dateFrom: "2026-08-01", dateTo: "2026-08-31", available: true },
      ],
      "2026-08-24",
      "2026-08-30",
      ["p1"],
    );
    expect(cells[0]?.assignedAssets).toBe(1);
  });
});
