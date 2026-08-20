import { describe, expect, it } from "vitest";

import {
  computeLoadByPerson,
  countUnassignedOpenTasks,
  sumMinutesByPerson,
} from "./carga";
import { filterDueSoonTasks, filterOverdueTasks } from "./overdue";
import { computeThroughput } from "./throughput";
import {
  isTaskOpen,
  type OpsPersonRow,
  type OpsTaskRow,
  type OpsTimeEntryRow,
  type TaskStatus,
} from "./types";

// ══════════════════ Helpers de fixtures ══════════════════

function task(overrides: Partial<OpsTaskRow> = {}): OpsTaskRow {
  return {
    id: "task-x",
    assignee_ids: [],
    status: "sin_empezar",
    priority: "media",
    due_on: null,
    completed_at: null,
    created_at: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

function person(overrides: Partial<OpsPersonRow> = {}): OpsPersonRow {
  return { id: "p-x", full_name: "Nombre", active: true, ...overrides };
}

function entry(overrides: Partial<OpsTimeEntryRow> = {}): OpsTimeEntryRow {
  return { person_id: "p-x", minutes: 60, logged_on: "2026-07-15", ...overrides };
}

// ══════════════════ isTaskOpen ══════════════════

describe("isTaskOpen", () => {
  it("sin_empezar/en_proceso/bloqueado/alerta_maxima abiertas; listo no", () => {
    const cases: [TaskStatus, boolean][] = [
      ["sin_empezar", true],
      ["en_proceso", true],
      ["bloqueado", true],
      ["alerta_maxima", true],
      ["listo", false],
    ];
    for (const [status, expected] of cases) {
      expect(isTaskOpen(status)).toBe(expected);
    }
  });
});

// ══════════════════ filterOverdueTasks ══════════════════

describe("filterOverdueTasks", () => {
  const today = "2026-07-28";

  it("tarea abierta con due_on < today es overdue", () => {
    const overdue = filterOverdueTasks(
      [task({ id: "a", status: "sin_empezar", due_on: "2026-07-27" })],
      today,
    );
    expect(overdue).toHaveLength(1);
    expect(overdue[0]!.id).toBe("a");
  });

  it("empatar due_on = today NO es overdue (vence hoy)", () => {
    const overdue = filterOverdueTasks(
      [task({ id: "a", status: "sin_empezar", due_on: today })],
      today,
    );
    expect(overdue).toHaveLength(0);
  });

  it("tarea CERRADA con due_on pasado NO es overdue (ya salió)", () => {
    const overdue = filterOverdueTasks(
      [task({ id: "a", status: "listo", due_on: "2026-07-01" })],
      today,
    );
    expect(overdue).toHaveLength(0);
  });

  it("due_on = null nunca es overdue (sin vencimiento)", () => {
    const overdue = filterOverdueTasks(
      [task({ status: "sin_empezar", due_on: null })],
      today,
    );
    expect(overdue).toHaveLength(0);
  });

  it("mezcla: solo cuenta las que cumplen ambas condiciones", () => {
    const overdue = filterOverdueTasks(
      [
        task({ id: "ok", status: "en_proceso", due_on: "2026-07-27" }),
        task({ id: "closed", status: "listo", due_on: "2026-07-27" }),
        task({ id: "no-due", status: "sin_empezar", due_on: null }),
        task({ id: "future", status: "sin_empezar", due_on: "2026-08-15" }),
        task({ id: "blocked-ok", status: "bloqueado", due_on: "2026-07-01" }),
      ],
      today,
    );
    expect(overdue.map((t) => t.id).sort()).toEqual(["blocked-ok", "ok"]);
  });
});

// ══════════════════ filterDueSoonTasks ══════════════════

describe("filterDueSoonTasks", () => {
  const today = "2026-07-28";

  it("ventana 7 días incluye today y today+7 (bordes inclusivos)", () => {
    const soon = filterDueSoonTasks(
      [
        task({ id: "today", status: "sin_empezar", due_on: "2026-07-28" }),
        task({ id: "last", status: "sin_empezar", due_on: "2026-08-04" }),   // +7
        task({ id: "beyond", status: "sin_empezar", due_on: "2026-08-05" }), // +8
        task({ id: "past", status: "sin_empezar", due_on: "2026-07-27" }),
      ],
      today,
      7,
    );
    expect(soon.map((t) => t.id).sort()).toEqual(["last", "today"]);
  });

  it("windowDays < 0 devuelve vacío (no vale ventana negativa)", () => {
    const soon = filterDueSoonTasks(
      [task({ status: "sin_empezar", due_on: "2026-07-28" })],
      today,
      -1,
    );
    expect(soon).toHaveLength(0);
  });

  it("tarea CERRADA no entra aunque tenga due_on en ventana", () => {
    const soon = filterDueSoonTasks(
      [task({ status: "listo", due_on: "2026-07-29" })],
      today,
      7,
    );
    expect(soon).toHaveLength(0);
  });
});

// ══════════════════ computeLoadByPerson ══════════════════

describe("computeLoadByPerson", () => {
  const today = "2026-07-28";

  it("cuenta open/overdue/dueSoon por persona respetando el orden del input", () => {
    const load = computeLoadByPerson({
      today,
      people: [
        person({ id: "ana", full_name: "Ana" }),
        person({ id: "bob", full_name: "Bob" }),
      ],
      tasks: [
        // Ana: 2 abiertas, 1 overdue, 1 dueSoon (empate=hoy)
        task({ id: "a1", assignee_ids: ["ana"], status: "sin_empezar", due_on: "2026-07-26" }), // overdue
        task({ id: "a2", assignee_ids: ["ana"], status: "en_proceso", due_on: "2026-07-28" }), // dueSoon (hoy)
        // Bob: 3 abiertas — 0 overdue, 1 dueSoon en 7 días
        task({ id: "b1", assignee_ids: ["bob"], status: "sin_empezar", due_on: null }),
        task({ id: "b2", assignee_ids: ["bob"], status: "bloqueado", due_on: "2026-08-10" }),
        task({ id: "b3", assignee_ids: ["bob"], status: "en_proceso", due_on: "2026-07-30" }), // dueSoon
        // Cerradas no cuentan
        task({ id: "closed", assignee_ids: ["ana"], status: "listo", due_on: "2026-07-01" }),
      ],
    });

    expect(load).toHaveLength(2);
    expect(load[0]!).toMatchObject({
      personId: "ana", personName: "Ana",
      open: 2, overdue: 1, dueSoon: 1,
    });
    expect(load[1]!).toMatchObject({
      personId: "bob", personName: "Bob",
      open: 3, overdue: 0, dueSoon: 1,
    });
  });

  it("persona con 0 tareas aparece con contadores en 0 (no la omite)", () => {
    const load = computeLoadByPerson({
      today,
      people: [person({ id: "solo", full_name: "Solo" })],
      tasks: [],
    });
    expect(load).toEqual([
      { personId: "solo", personName: "Solo", active: true,
        open: 0, overdue: 0, dueSoon: 0 },
    ]);
  });

  it("tareas SIN assignee no se suman a ninguna persona", () => {
    const load = computeLoadByPerson({
      today,
      people: [person({ id: "ana", full_name: "Ana" })],
      tasks: [
        task({ assignee_ids: [], status: "sin_empezar" }),
        task({ assignee_ids: [], status: "sin_empezar", due_on: "2026-07-01" }),
      ],
    });
    expect(load[0]!.open).toBe(0);
    expect(load[0]!.overdue).toBe(0);
  });

  it("dueSoonWindowDays personalizable", () => {
    const load = computeLoadByPerson({
      today,
      dueSoonWindowDays: 1,
      people: [person({ id: "ana", full_name: "Ana" })],
      tasks: [
        task({ assignee_ids: ["ana"], status: "sin_empezar", due_on: "2026-07-28" }), // hoy
        task({ assignee_ids: ["ana"], status: "sin_empezar", due_on: "2026-07-29" }), // mañana
        task({ assignee_ids: ["ana"], status: "sin_empezar", due_on: "2026-07-30" }), // pasado
      ],
    });
    expect(load[0]!.open).toBe(3);
    expect(load[0]!.dueSoon).toBe(2); // hoy + mañana, no pasado
  });
});

describe("countUnassignedOpenTasks", () => {
  it("cuenta abiertas sin assignee, ignora cerradas y las que sí tienen dueño", () => {
    const n = countUnassignedOpenTasks([
      task({ assignee_ids: [], status: "sin_empezar" }),
      task({ assignee_ids: [], status: "bloqueado" }),
      task({ assignee_ids: ["ana"], status: "sin_empezar" }), // tiene dueño
      task({ assignee_ids: [], status: "listo" }),        // cerrada
    ]);
    expect(n).toBe(2);
  });
});

// ══════════════════ sumMinutesByPerson ══════════════════

describe("sumMinutesByPerson", () => {
  it("suma minutes por person_id", () => {
    const map = sumMinutesByPerson([
      entry({ person_id: "ana", minutes: 60 }),
      entry({ person_id: "ana", minutes: 30 }),
      entry({ person_id: "bob", minutes: 120 }),
    ]);
    expect(map.get("ana")).toBe(90);
    expect(map.get("bob")).toBe(120);
    expect(map.size).toBe(2);
  });

  it("input vacío devuelve Map vacío (no revienta)", () => {
    expect(sumMinutesByPerson([]).size).toBe(0);
  });
});

// ══════════════════ computeThroughput ══════════════════

describe("computeThroughput", () => {
  const from = "2026-07-01T00:00:00Z";
  const to = "2026-07-31T23:59:59Z";

  it("cuenta listo dentro de [from,to] y promedia el ciclo", () => {
    const t = computeThroughput({
      from, to,
      tasks: [
        task({ status: "listo", created_at: "2026-07-01T00:00:00Z",
               completed_at: "2026-07-05T00:00:00Z" }),   // 4 días
        task({ status: "listo", created_at: "2026-07-10T00:00:00Z",
               completed_at: "2026-07-12T00:00:00Z" }),   // 2 días
      ],
    });
    expect(t.completed).toBe(2);
    expect(t.avgCycleDays).toBe(3); // (4+2)/2
  });

  it("filtra por completed_at ∉ ventana", () => {
    const t = computeThroughput({
      from, to,
      tasks: [
        task({ status: "listo", created_at: "2026-06-01T00:00:00Z",
               completed_at: "2026-06-15T00:00:00Z" }),  // FUERA
        task({ status: "listo", created_at: "2026-08-01T00:00:00Z",
               completed_at: "2026-08-15T00:00:00Z" }),  // FUERA
        task({ status: "listo", created_at: "2026-07-01T00:00:00Z",
               completed_at: "2026-07-05T00:00:00Z" }),   // dentro
      ],
    });
    expect(t.completed).toBe(1);
    expect(t.avgCycleDays).toBe(4);
  });

  it("ignora tareas sin completed_at (aún abiertas)", () => {
    const t = computeThroughput({
      from, to,
      tasks: [
        task({ status: "sin_empezar", completed_at: null }),
        task({ status: "en_proceso", completed_at: null }),
      ],
    });
    expect(t.completed).toBe(0);
    expect(t.avgCycleDays).toBeNull();
  });

  it("0 listo → avgCycleDays null (no NaN)", () => {
    const t = computeThroughput({
      from, to,
      tasks: [
        task({ status: "sin_empezar", created_at: "2026-07-01T00:00:00Z",
               completed_at: null }),
      ],
    });
    expect(t.completed).toBe(0);
    expect(t.avgCycleDays).toBeNull();
  });

  it("guard contra completed_at anterior a created_at (data mala)", () => {
    const t = computeThroughput({
      from, to,
      tasks: [
        task({ status: "listo", created_at: "2026-07-10T00:00:00Z",
               completed_at: "2026-07-05T00:00:00Z" }),   // negativo, se ignora
        task({ status: "listo", created_at: "2026-07-01T00:00:00Z",
               completed_at: "2026-07-11T00:00:00Z" }),   // 10 días
      ],
    });
    expect(t.completed).toBe(2); // los cuenta a ambos como completed
    expect(t.avgCycleDays).toBe(5); // (0 + 10) / 2 — el negativo aporta 0
  });
});
