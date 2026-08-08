import { describe, expect, it } from "vitest";

import {
  classifyNps,
  computeHealthScore,
  computeNps,
  computeTicketLoad,
  daysSinceLastContact,
} from "./health";
import type { NpsResponseRow, TicketRow } from "./types";

function nps(overrides: Partial<NpsResponseRow> = {}): NpsResponseRow {
  return {
    client_id: "cli-a",
    score: 8,
    responded_at: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

function ticket(overrides: Partial<TicketRow> = {}): TicketRow {
  return {
    client_id: "cli-a",
    project_id: null,
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

describe("computeHealthScore", () => {
  const NOW = new Date("2026-08-04T12:00:00Z");

  it("los 3 ingredientes presentes usa pesos 40/30/30", () => {
    // NPS 8 → 80; contact hace 0 días → 100; 0 urgentes → 100.
    // Score = 80*0.4 + 100*0.3 + 100*0.3 = 32 + 30 + 30 = 92.
    const r = computeHealthScore({
      nps: [nps({ score: 8, responded_at: "2026-08-04T00:00:00Z" })],
      lastContactAt: "2026-08-04T12:00:00Z",
      tickets: [],
      now: NOW,
    });
    expect(r.npsComponent).toBe(80);
    expect(r.contactComponent).toBe(100);
    expect(r.ticketsComponent).toBe(100);
    expect(r.weights).toEqual({ nps: 0.4, contact: 0.3, tickets: 0.3 });
    expect(r.score).toBe(92);
    expect(r.isLimited).toBe(false);
  });

  it("cliente perfecto (NPS 10, contact hoy, 0 urgentes) → score 100", () => {
    const r = computeHealthScore({
      nps: [nps({ score: 10, responded_at: "2026-08-04T00:00:00Z" })],
      lastContactAt: "2026-08-04T12:00:00Z",
      tickets: [],
      now: NOW,
    });
    expect(r.score).toBe(100);
  });

  it("cliente pésimo (NPS 0, contact >90d, 4+ urgentes) → score 0", () => {
    const r = computeHealthScore({
      nps: [nps({ score: 0, responded_at: "2026-08-04T00:00:00Z" })],
      lastContactAt: "2025-01-01T00:00:00Z", // muy atrás
      tickets: [
        ticket({ status: "abierto", priority: "urgente" }),
        ticket({ status: "abierto", priority: "urgente" }),
        ticket({ status: "abierto", priority: "urgente" }),
        ticket({ status: "abierto", priority: "urgente" }),
      ],
      now: NOW,
    });
    expect(r.score).toBe(0);
  });

  it("sin NPS reciente redistribuye a contact 50 / tickets 50", () => {
    const r = computeHealthScore({
      nps: [],
      lastContactAt: "2026-08-04T12:00:00Z", // contact hoy = 100
      tickets: [], // 0 urgentes = 100
      now: NOW,
    });
    expect(r.npsComponent).toBeNull();
    expect(r.weights).toEqual({ nps: 0, contact: 0.5, tickets: 0.5 });
    // 100*0.5 + 100*0.5 = 100
    expect(r.score).toBe(100);
    expect(r.isLimited).toBe(true);
  });

  it("sin contact redistribuye a NPS 60 / tickets 40", () => {
    const r = computeHealthScore({
      nps: [nps({ score: 5, responded_at: "2026-08-04T00:00:00Z" })], // 50
      lastContactAt: null,
      tickets: [], // 100
      now: NOW,
    });
    expect(r.contactComponent).toBeNull();
    expect(r.weights).toEqual({ nps: 0.6, contact: 0, tickets: 0.4 });
    // 50*0.6 + 100*0.4 = 30 + 40 = 70
    expect(r.score).toBe(70);
    expect(r.isLimited).toBe(true);
  });

  it("sin NPS ni contact → solo tickets, weight 100%", () => {
    const r = computeHealthScore({
      nps: [],
      lastContactAt: null,
      tickets: [
        ticket({ status: "abierto", priority: "urgente" }),
        ticket({ status: "abierto", priority: "urgente" }),
      ],
      now: NOW,
    });
    expect(r.weights).toEqual({ nps: 0, contact: 0, tickets: 1 });
    // 100 - 2*25 = 50
    expect(r.ticketsComponent).toBe(50);
    expect(r.score).toBe(50);
    expect(r.isLimited).toBe(true);
  });

  it("NPS antiguo (>90d) NO cuenta — se comporta como sin NPS", () => {
    const r = computeHealthScore({
      // 100 días atrás — fuera de la ventana de 90d.
      nps: [nps({ score: 10, responded_at: "2026-04-26T00:00:00Z" })],
      lastContactAt: "2026-08-04T12:00:00Z",
      tickets: [],
      now: NOW,
    });
    expect(r.npsComponent).toBeNull();
    expect(r.isLimited).toBe(true);
    expect(r.weights.nps).toBe(0);
  });

  it("elige el NPS MÁS RECIENTE entre varios dentro de la ventana", () => {
    const r = computeHealthScore({
      nps: [
        nps({ score: 3, responded_at: "2026-06-01T00:00:00Z" }), // viejo, detractor
        nps({ score: 10, responded_at: "2026-08-01T00:00:00Z" }), // más reciente, promoter
        nps({ score: 5, responded_at: "2026-07-15T00:00:00Z" }), // medio
      ],
      lastContactAt: null,
      tickets: [],
      now: NOW,
    });
    // Debe agarrar el score=10 → npsComponent=100.
    expect(r.npsComponent).toBe(100);
  });

  it("contact_component decae linealmente hasta 90d", () => {
    // A 45 días exactos → 100 - 45*100/90 = 100 - 50 = 50. Alineamos hora
    // con NOW para que daysSinceLastContact (que hace ceil) no bumpee.
    const r = computeHealthScore({
      nps: [],
      lastContactAt: "2026-06-20T12:00:00Z",
      tickets: [],
      now: NOW,
    });
    expect(r.contactComponent).toBe(50);
  });

  it("contact >90d clampea a 0 (no negativo)", () => {
    const r = computeHealthScore({
      nps: [],
      lastContactAt: "2026-01-01T00:00:00Z", // ~215 días atrás
      tickets: [],
      now: NOW,
    });
    expect(r.contactComponent).toBe(0);
  });

  it("tickets score baja de a 25 por urgente abierto", () => {
    const mkTickets = (n: number) =>
      Array.from({ length: n }, () =>
        ticket({ status: "abierto", priority: "urgente" }),
      );
    expect(
      computeHealthScore({
        nps: [],
        lastContactAt: null,
        tickets: mkTickets(1),
        now: NOW,
      }).ticketsComponent,
    ).toBe(75);
    expect(
      computeHealthScore({
        nps: [],
        lastContactAt: null,
        tickets: mkTickets(3),
        now: NOW,
      }).ticketsComponent,
    ).toBe(25);
    expect(
      computeHealthScore({
        nps: [],
        lastContactAt: null,
        tickets: mkTickets(10),
        now: NOW,
      }).ticketsComponent,
    ).toBe(0);
  });

  it("tickets no-urgentes NO restan al score de tickets", () => {
    const r = computeHealthScore({
      nps: [],
      lastContactAt: null,
      tickets: [
        ticket({ status: "abierto", priority: "alta" }),
        ticket({ status: "abierto", priority: "media" }),
        ticket({ status: "abierto", priority: "baja" }),
      ],
      now: NOW,
    });
    expect(r.ticketsComponent).toBe(100);
  });

  it("tickets cerrados NO restan aunque sean urgentes", () => {
    const r = computeHealthScore({
      nps: [],
      lastContactAt: null,
      tickets: [
        ticket({
          status: "resuelto",
          priority: "urgente",
          resolved_at: "2026-07-01T00:00:00Z",
        }),
      ],
      now: NOW,
    });
    expect(r.ticketsComponent).toBe(100);
  });

  it("score final es entero redondeado", () => {
    // NPS 7 → 70; contact hace 30 días exactos → 100 - 30*100/90 ≈ 66.67;
    // 0 urgentes = 100. Score = 70*0.4 + 66.67*0.3 + 100*0.3 ≈ 77.67 → 78.
    const r = computeHealthScore({
      nps: [nps({ score: 7, responded_at: "2026-08-04T12:00:00Z" })],
      lastContactAt: "2026-07-05T12:00:00Z",
      tickets: [],
      now: NOW,
    });
    expect(Number.isInteger(r.score)).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.score).toBe(78);
  });
});
