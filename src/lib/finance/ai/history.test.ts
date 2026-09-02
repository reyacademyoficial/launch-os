import { describe, expect, it } from "vitest";

import type { ChatTurn } from "@/lib/ai/client";

import { trimHistory, withTrimNotice } from "./history";

function thread(count: number, size = 10): ChatTurn[] {
  return Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content: `m${i}`.padEnd(size, "x"),
  }));
}

describe("trimHistory — ventana deslizante desde el final", () => {
  it("deja pasar entero un hilo corto", () => {
    const turns = thread(6);
    const out = trimHistory(turns);
    expect(out.turns).toHaveLength(6);
    expect(out.droppedTurns).toBe(0);
  });

  it("conserva los turnos MÁS RECIENTES cuando excede maxTurns", () => {
    const turns = thread(10);
    const out = trimHistory(turns, { maxTurns: 4 });
    expect(out.turns).toHaveLength(4);
    // Los últimos 4 del hilo, en orden cronológico.
    expect(out.turns.map((t) => t.content)).toEqual(
      turns.slice(-4).map((t) => t.content),
    );
    expect(out.droppedTurns).toBe(6);
  });

  it("corta por presupuesto de caracteres", () => {
    const turns = thread(10, 100);
    const out = trimHistory(turns, { maxChars: 250 });
    expect(out.turns.length).toBeLessThanOrEqual(3);
    expect(out.turns.at(-1)).toEqual(turns.at(-1));
  });

  it("el último turno entra SIEMPRE, aunque solo él exceda el presupuesto", () => {
    // Sin este guard un mensaje largo del usuario dejaría el array vacío y
    // la llamada al proveedor fallaría.
    const turns: ChatTurn[] = [
      { role: "user", content: "viejo" },
      { role: "user", content: "x".repeat(50_000) },
    ];
    const out = trimHistory(turns, { maxChars: 100 });
    expect(out.turns).toHaveLength(1);
    expect(out.turns[0]!.content).toHaveLength(50_000);
  });

  it("descarta un assistant huérfano al inicio del recorte", () => {
    const turns: ChatTurn[] = [
      { role: "user", content: "p1" },
      { role: "assistant", content: "r1" },
      { role: "user", content: "p2" },
      { role: "assistant", content: "r2" },
    ];
    const out = trimHistory(turns, { maxTurns: 3 });
    expect(out.turns[0]!.role).toBe("user");
    expect(out.turns.map((t) => t.content)).toEqual(["p2", "r2"]);
  });

  it("hilo de un solo turno no se vacía por el guard de assistant huérfano", () => {
    const out = trimHistory([{ role: "assistant", content: "solo" }]);
    expect(out.turns).toHaveLength(1);
  });
});

describe("withTrimNotice", () => {
  it("no toca el hilo si no hubo poda", () => {
    const turns = thread(4);
    const out = withTrimNotice({ turns, droppedTurns: 0 });
    expect(out).toBe(turns);
  });

  it("avisa al modelo que hay mensajes previos fuera del contexto", () => {
    const turns: ChatTurn[] = [{ role: "user", content: "pregunta" }];
    const out = withTrimNotice({ turns, droppedTurns: 7 });
    expect(out[0]!.content).toContain("7 mensajes previos");
    expect(out[0]!.content).toContain("pregunta");
    expect(out[0]!.role).toBe("user");
  });
});
