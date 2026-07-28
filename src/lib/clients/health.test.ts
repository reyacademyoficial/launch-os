import { describe, expect, it } from "vitest";

import {
  classifyNps,
  computeNps,
  computeTicketLoad,
  daysSinceLastContact,
} from "./health";
import type { NpsResponseRow, TicketRow } from "./types";

function nps(overrides: Partial<NpsResponseRow> = {}): NpsResponseRow {
  return {
    project_id: "proj-a",
    score: 8,
    responded_at: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

function ticket(overrides: Partial<TicketRow> = {}): TicketRow {
  return {
    project_id: "proj-a",
    status: "abierto",
    priority: "media",
    created_at: "2026-07-01T00:00:00Z",
    resolved_at: null,
    ...overrides,
  };
}

describe("classifyNps", () => {
  it("promoter para 9 y 10", () => {
    expect(classifyNps(9)).toBe("promoter");
    expect(classifyNps(10)).toBe("promoter");
  });
  it("passive para 7 y 8", () => {
    expect(classifyNps(7)).toBe("passive");
    expect(classifyNps(8)).toBe("passive");
  });
  it("detractor para 0..6 inclusive", () => {
    expect(classifyNps(0)).toBe("detractor");
    expect(classifyNps(6)).toBe("detractor");
  });
});

describe("computeNps", () => {
  it("devuelve nulls con 0 respuestas (no confundir con 0)", () => {
    const b = computeNps([]);
    expect(b.totalResponses).toBe(0);
    expect(b.npsScore).toBeNull();
    expect(b.averageScore).toBeNull();
  });

  it("todos promoters → +100", () => {
    const b = computeNps([nps({ score: 10 }), nps({ score: 9 })]);
    expect(b.promoters).toBe(2);
    expect(b.npsScore).toBe(100);
  });

  it("todos detractors → -100", () => {
    const b = computeNps([nps({ score: 0 }), nps({ score: 5 })]);
    expect(b.detractors).toBe(2);
    expect(b.npsScore).toBe(-100);
  });

  it("mezcla 2P + 1p + 1D sobre 4 respuestas → (2-1)/4 = 25", () => {
    const b = computeNps([
      nps({ score: 10 }),
      nps({ score: 9 }),
      nps({ score: 8 }),
      nps({ score: 3 }),
    ]);
    expect(b.promoters).toBe(2);
    expect(b.passives).toBe(1);
    expect(b.detractors).toBe(1);
    expect(b.npsScore).toBe(25);
    expect(b.averageScore).toBe(7.5);
  });

  it("passives NO mueven la aguja del NPS score", () => {
    const b = computeNps([nps({ score: 7 }), nps({ score: 8 })]);
    expect(b.npsScore).toBe(0);
  });
});

describe("daysSinceLastContact", () => {
  const now = new Date("2026-07-30T12:00:00Z");

  it("null si no hubo contacto", () => {
    expect(
      daysSinceLastContact({ last_contact_at: null }, now),
    ).toBeNull();
  });

  it("cuenta días redondeando hacia arriba", () => {
    // 3.5 días → 4
    expect(
      daysSinceLastContact(
        { last_contact_at: "2026-07-27T00:00:00Z" },
        now,
      ),
    ).toBe(4);
  });

  it("fecha futura devuelve 0 (no negativos)", () => {
    expect(
      daysSinceLastContact(
        { last_contact_at: "2026-08-05T00:00:00Z" },
        now,
      ),
    ).toBe(0);
  });
});

describe("computeTicketLoad", () => {
  it("cuenta abierto/en_progreso/esperando_cliente como abiertos", () => {
    const load = computeTicketLoad([
      ticket({ status: "abierto" }),
      ticket({ status: "en_progreso" }),
      ticket({ status: "esperando_cliente" }),
      ticket({ status: "resuelto", resolved_at: "2026-07-01T00:00:00Z" }),
      ticket({ status: "cerrado", resolved_at: "2026-07-01T00:00:00Z" }),
    ]);
    expect(load.openTickets).toBe(3);
    expect(load.urgentOpenTickets).toBe(0);
  });

  it("urgentOpenTickets solo cuenta priority=urgente Y status abierto", () => {
    const load = computeTicketLoad([
      ticket({ status: "abierto", priority: "urgente" }),
      ticket({ status: "en_progreso", priority: "urgente" }),
      ticket({
        status: "resuelto",
        priority: "urgente",
        resolved_at: "2026-07-01T00:00:00Z",
      }),
      ticket({ status: "abierto", priority: "alta" }),
    ]);
    expect(load.openTickets).toBe(3);
    expect(load.urgentOpenTickets).toBe(2);
  });
});
