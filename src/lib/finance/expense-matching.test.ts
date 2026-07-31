import { describe, expect, it } from "vitest";

import {
  scoreExpenseMatches,
  type MovementCandidate,
} from "./expense-matching";

function mov(
  overrides: Partial<MovementCandidate> & { id: string },
): MovementCandidate {
  return {
    amount: 1000,
    occurredAt: "2026-07-10",
    currency: "ARS",
    kind: "out",
    ...overrides,
  };
}

describe("scoreExpenseMatches", () => {
  it("nunca filtra: siempre devuelve TODOS los movimientos", () => {
    // Regla de oro documentada. Un candidato terrible sigue apareciendo,
    // al final del listado. Esto es lo que evita el bug del "está oculto,
    // cargalo de nuevo → duplicado".
    const results = scoreExpenseMatches(
      {
        expenseAmountGross: 1000,
        expenseDateYmd: "2026-07-10",
        expenseCurrency: "ARS",
      },
      [
        mov({ id: "exacto", amount: 1000, occurredAt: "2026-07-10" }),
        mov({ id: "lejos", amount: 999999, occurredAt: "2020-01-01" }),
      ],
    );
    expect(results.length).toBe(2);
    expect(results.map((r) => r.movement.id)).toEqual(["exacto", "lejos"]);
  });

  it("monto exacto + mismo día + misma moneda → score 100", () => {
    const [top] = scoreExpenseMatches(
      {
        expenseAmountGross: 1000,
        expenseDateYmd: "2026-07-10",
        expenseCurrency: "ARS",
      },
      [mov({ id: "a", amount: 1000, occurredAt: "2026-07-10" })],
    );
    expect(top?.score).toBe(100);
  });

  it("prioriza el candidato exacto sobre uno con recargo del 10%", () => {
    // Un recargo del 10% (tipo comisión de un pago) es un caso REAL de
    // por qué el matching no puede filtrar por ±5%. El scorer los pone
    // ambos arriba, con el exacto primero.
    const results = scoreExpenseMatches(
      {
        expenseAmountGross: 1000,
        expenseDateYmd: "2026-07-10",
        expenseCurrency: "ARS",
      },
      [
        mov({ id: "conRecargo", amount: 1100, occurredAt: "2026-07-10" }),
        mov({ id: "exacto", amount: 1000, occurredAt: "2026-07-10" }),
      ],
    );
    expect(results[0]?.movement.id).toBe("exacto");
    expect(results[1]?.movement.id).toBe("conRecargo");
    // Y ambos tienen score > 0 — el de recargo no queda hundido.
    expect(results[1]?.score ?? 0).toBeGreaterThan(50);
  });

  it("un candidato con 20 días de diferencia sigue siendo alcanzable", () => {
    // Bug que el filtrado ±14 días hubiera generado. Con scoring, 20 días
    // recibe score menor pero visible. Feedback explícito del brief.
    const results = scoreExpenseMatches(
      {
        expenseAmountGross: 1000,
        expenseDateYmd: "2026-07-10",
        expenseCurrency: "ARS",
      },
      [mov({ id: "veinteDias", amount: 1000, occurredAt: "2026-07-30" })],
    );
    // No es cero — es alcanzable.
    expect(results[0]?.score ?? 0).toBeGreaterThan(20);
    // 20 días de diferencia queda registrado.
    expect(results[0]?.daysDiff).toBe(20);
  });

  it("kind='in' recibe score 0 — un ingreso no paga un gasto", () => {
    // El humano puede haber cargado un 'in' que era 'out'. Se ve al final,
    // no arriba. Nunca se le sugiere como probable.
    const results = scoreExpenseMatches(
      {
        expenseAmountGross: 1000,
        expenseDateYmd: "2026-07-10",
        expenseCurrency: "ARS",
      },
      [
        mov({ id: "ingreso", amount: 1000, occurredAt: "2026-07-10", kind: "in" }),
        mov({ id: "egreso", amount: 500, occurredAt: "2026-06-01", kind: "out" }),
      ],
    );
    // El egreso, aunque peor coincidencia, va arriba porque el 'in' es 0.
    expect(results[0]?.movement.id).toBe("egreso");
    expect(results[1]?.movement.id).toBe("ingreso");
    expect(results[1]?.score).toBe(0);
  });

  it("moneda distinta penaliza pero no oculta", () => {
    // Warning del brief: vincular ARS a USD es un error silencioso. La UI
    // advierte con currencyMatches=false, pero el candidato queda accesible.
    const results = scoreExpenseMatches(
      {
        expenseAmountGross: 1000,
        expenseDateYmd: "2026-07-10",
        expenseCurrency: "ARS",
      },
      [
        mov({ id: "usd", amount: 1000, occurredAt: "2026-07-10", currency: "USD" }),
      ],
    );
    expect(results[0]?.currencyMatches).toBe(false);
    // Penalizado (factor 0.4) pero no cero.
    expect(results[0]?.score ?? 0).toBeGreaterThan(0);
    expect(results[0]?.score ?? 0).toBeLessThan(50);
  });

  it("ordena estable por (score desc, daysDiff asc, id lex)", () => {
    // Determinismo para tests y para que el humano no vea el orden bailar
    // entre re-renders.
    const results = scoreExpenseMatches(
      {
        expenseAmountGross: 1000,
        expenseDateYmd: "2026-07-10",
        expenseCurrency: "ARS",
      },
      [
        // Todos empatan en monto exacto y misma fecha; desempate por id.
        mov({ id: "c", amount: 1000, occurredAt: "2026-07-10" }),
        mov({ id: "a", amount: 1000, occurredAt: "2026-07-10" }),
        mov({ id: "b", amount: 1000, occurredAt: "2026-07-10" }),
      ],
    );
    expect(results.map((r) => r.movement.id)).toEqual(["a", "b", "c"]);
  });

  it("amountDiffPct y daysDiff se reportan con signo/valor útiles", () => {
    // El drawer los muestra al humano — hay que preservar la información
    // exacta, no solo el score compuesto.
    const [r] = scoreExpenseMatches(
      {
        expenseAmountGross: 1000,
        expenseDateYmd: "2026-07-10",
        expenseCurrency: "ARS",
      },
      [mov({ id: "x", amount: 500, occurredAt: "2026-07-05" })],
    );
    expect(r?.amountDiffPct).toBeCloseTo(0.5);
    // Negativo → el movimiento es anterior al gasto (raro pero se ve).
    expect(r?.daysDiff).toBe(-5);
  });
});
