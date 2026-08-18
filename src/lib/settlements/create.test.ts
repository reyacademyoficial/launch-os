import { describe, expect, it, vi } from "vitest";

import { createComplementarySettlement, createSettlement } from "./create";

/**
 * Fake mínimo del cliente Supabase — soporta solo los métodos que usa
 * `create.ts`. Un test declara una lista de "respuestas" indexadas por
 * tabla (en orden de llamada), y el fake las devuelve.
 *
 * Cada entrada matchea un `.from(table)`; los eslabones posteriores
 * (.select/.eq/.in/.is/.limit/.maybeSingle/etc.) son no-ops que devuelven
 * la misma cadena. `insert()` es un método terminal que se espía aparte.
 *
 * El fake NO valida los argumentos de los filtros — asume que `create.ts`
 * arma bien las queries. Los tests que quieran verificarlo lo hacen a
 * través del `insertSpy` o inspeccionando el payload devuelto.
 */

interface FakeResponse {
  data: unknown;
  error: null | { message: string };
}

/**
 * Cada tabla tiene una cola FIFO de respuestas. Cada `.from(t)` consume
 * la próxima respuesta de la cola de esa tabla.
 */
type ResponseQueues = Record<string, FakeResponse[]>;

function makeFake(queues: ResponseQueues) {
  const insertSpy = vi.fn();

  function chain(response: FakeResponse) {
    const link: any = {};
    // Métodos de filtro/orden encadenables — todos devuelven el mismo link.
    for (const m of [
      "select",
      "eq",
      "in",
      "is",
      "order",
      "limit",
      "not",
      "neq",
    ]) {
      link[m] = () => link;
    }
    // Métodos terminales — devuelven la respuesta.
    link.maybeSingle = async () => response;
    link.single = async () => response;
    // `.select("id")` seguido de nada más (como en el array) también
    // debería resolverse — hacemos el chain "then-able".
    link.then = (onFulfilled: (r: FakeResponse) => unknown) =>
      Promise.resolve(response).then(onFulfilled);
    return link;
  }

  const fromFn = (table: string) => {
    const queue = queues[table];
    if (!queue || queue.length === 0) {
      throw new Error(
        `Fake supabase: sin respuestas queueadas para tabla "${table}"`,
      );
    }
    const response = queue.shift() as FakeResponse;

    const c: any = chain(response);

    // insert() es especial: se registra en el spy y devuelve un chain que
    // termina con `single()` para leer el id.
    c.insert = (row: unknown) => {
      insertSpy(table, row);
      return chain(response);
    };

    return c;
  };

  return { supabase: { from: fromFn } as unknown as never, insertSpy };
}

// Helpers para armar respuestas rápidas.
const ok = (data: unknown): FakeResponse => ({ data, error: null });
const empty: FakeResponse = { data: null, error: null };

const LAUNCH_ID = "launch-abc";
const PROJECT_ID = "project-xyz";
const ORG_ID = "org-1";

/**
 * Respuesta canónica de `launches` — el launch existe y trae la
 * organización embebida vía el join a `projects`.
 */
const launchOk = ok({
  id: LAUNCH_ID,
  project_id: PROJECT_ID,
  projects: { organization_id: ORG_ID },
});

const activeRule = {
  id: "rule-1",
  organization_id: ORG_ID,
  project_id: PROJECT_ID,
  launch_id: null,
  name: "regla propia 100%",
  percent_of_collected: 100,
  fixed_fee_per_launch: 0,
  fixed_fee_per_sale: 0,
  min_guarantee: null,
  applies_on: "collected",
  active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  created_by: null,
};

describe("createSettlement", () => {
  it("no-rule: no hay settlement_rule para el launch ni default del proyecto", async () => {
    const { supabase, insertSpy } = makeFake({
      launches: [launchOk],
      // Regla launch-scope: null → cae al fallback
      // Regla project-default: null → no-rule
      settlement_rules: [empty, empty],
    });

    const res = await createSettlement(supabase as never, {
      launchId: LAUNCH_ID,
    });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("no-rule");
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("already-settled: existe una liquidación cerrada → bloquea (borradores NO)", async () => {
    const { supabase, insertSpy } = makeFake({
      launches: [launchOk],
      settlement_rules: [ok(activeRule)],
      // 1er hit: buscamos {liquidada, transferida} → devuelve una existente
      launch_settlements: [
        ok({ id: "existing-settlement", status: "liquidada" }),
      ],
    });

    const res = await createSettlement(supabase as never, {
      launchId: LAUNCH_ID,
    });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("already-settled");
    // El detail lleva el id de la existente para trazabilidad.
    expect(res.detail).toContain("existing-settlement");
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("borradores 'abierta' NO bloquean, se cuentan y se reportan", async () => {
    const { supabase, insertSpy } = makeFake({
      launches: [launchOk],
      settlement_rules: [ok(activeRule)],
      launch_settlements: [
        // 1er hit: no hay liquidada/transferida
        empty,
        // 2do hit: dos borradores abiertos
        ok([{ id: "draft-1" }, { id: "draft-2" }]),
      ],
      sales: [ok([{ id: "s1", total_amount: 1000 }])],
      payments: [ok([{ amount: 500 }])],
    });

    const res = await createSettlement(supabase as never, {
      launchId: LAUNCH_ID,
      dryRun: true,
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.draftsCount).toBe(2);
    // dryRun por default → nada de insert.
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("no-payments: launch sin pagos → no hay nada que liquidar", async () => {
    const { supabase, insertSpy } = makeFake({
      launches: [launchOk],
      settlement_rules: [ok(activeRule)],
      launch_settlements: [empty, ok([])],
      sales: [ok([{ id: "s1", total_amount: 999 }])],
      payments: [ok([])],
    });

    const res = await createSettlement(supabase as never, {
      launchId: LAUNCH_ID,
    });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("no-payments");
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("dryRun=true NUNCA llama a insert (verificación por spy)", async () => {
    const { supabase, insertSpy } = makeFake({
      launches: [launchOk],
      settlement_rules: [ok(activeRule)],
      launch_settlements: [empty, ok([])],
      sales: [ok([{ id: "s1", total_amount: 1000 }])],
      payments: [ok([{ amount: 700 }])],
    });

    const res = await createSettlement(supabase as never, {
      launchId: LAUNCH_ID,
      dryRun: true,
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.dryRun).toBe(true);
    expect(res.payload.collected_total).toBe(700);
    expect(res.payload.status).toBe("abierta");
    expect(res.payload.closed_at).toBeNull();
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("fan-out prevention: 2 sales con pagos desiguales; collectedTotal = Σ pagos, totalSold = Σ sales (sin multiplicar)", async () => {
    // Escenario: 2 ventas.
    //   sale A: total_amount 10.000, con 3 pagos de 1.000 c/u (parciales)
    //   sale B: total_amount  5.000, con 1 pago de 5.000
    //
    // El bug que este test evita: un join sales × payments sumaría
    // total_amount UNA VEZ POR PAGO. Es decir, totalSold "malo" sería:
    //   10.000 × 3 + 5.000 × 1 = 35.000, en vez del correcto 15.000.
    //
    // Con queries independientes, cada suma es la que corresponde:
    //   totalSold      = 10.000 + 5.000 = 15.000
    //   collectedTotal = 1.000 × 3 + 5.000 = 8.000
    //   salesCount     = 2
    //
    // Con regla propia (100%), Kingrow retiene todo lo cobrado (8.000).
    const { supabase, insertSpy } = makeFake({
      launches: [launchOk],
      settlement_rules: [ok(activeRule)],
      launch_settlements: [empty, ok([])],
      sales: [
        ok([
          { id: "sale-A", total_amount: 10_000 },
          { id: "sale-B", total_amount: 5_000 },
        ]),
      ],
      payments: [
        ok([
          { amount: 1_000 },
          { amount: 1_000 },
          { amount: 1_000 },
          { amount: 5_000 },
        ]),
      ],
    });

    const res = await createSettlement(supabase as never, {
      launchId: LAUNCH_ID,
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // El test central: totalSold NO se multiplicó por la cantidad de pagos.
    // Este es el bug que apareció en la query del gate anterior.
    expect(res.payload.collected_total).toBe(8_000);
    expect(res.payload.kingrow_retained).toBe(8_000); // 100% × cobrado
    expect(res.payload.owed_to_client).toBe(0);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("payload de una liquidación original tiene parent_settlement_id=null", async () => {
    // Contrato: solo las complementarias setean parent_settlement_id.
    // Este test blinda contra regresiones si alguien mueve el default.
    const { supabase } = makeFake({
      launches: [launchOk],
      settlement_rules: [ok(activeRule)],
      launch_settlements: [empty, ok([])],
      sales: [ok([{ id: "s1", total_amount: 1000 }])],
      payments: [ok([{ amount: 500 }])],
    });

    const res = await createSettlement(supabase as never, {
      launchId: LAUNCH_ID,
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payload.parent_settlement_id).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// createComplementarySettlement — tests
// ═══════════════════════════════════════════════════════════════════════════

const externalRule = {
  ...activeRule,
  id: "rule-ext",
  name: "regla externa 30%",
  percent_of_collected: 30,
  fixed_fee_per_launch: 5_000, // ← se cobró en la original, NO se re-cobra
  fixed_fee_per_sale: 100,     // ← idem
  min_guarantee: 15_000,        // ← idem
};

describe("createComplementarySettlement", () => {
  it("no-closed-settlement: sin liquidaciones cerradas previas", async () => {
    const { supabase, insertSpy } = makeFake({
      launches: [launchOk],
      settlement_rules: [ok(externalRule)],
      // Sin cerradas
      launch_settlements: [ok([])],
    });

    const res = await createComplementarySettlement(supabase as never, {
      launchId: LAUNCH_ID,
    });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("no-closed-settlement");
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("no-new-payments: no hay delta cobrado desde la liquidación anterior", async () => {
    const { supabase, insertSpy } = makeFake({
      launches: [launchOk],
      settlement_rules: [ok(externalRule)],
      // Una cerrada con collected_total=1000
      launch_settlements: [
        ok([
          {
            id: "prev-1",
            collected_total: 1000,
            created_at: "2026-01-01T00:00:00Z",
          },
        ]),
      ],
      // Total payments actual = 1000 (ya está todo liquidado)
      sales: [ok([{ id: "s1", total_amount: 1000 }])],
      payments: [ok([{ amount: 1000 }])],
    });

    const res = await createComplementarySettlement(supabase as never, {
      launchId: LAUNCH_ID,
    });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("no-new-payments");
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("delta positivo → arma complementaria con solo % sobre lo nuevo", async () => {
    // Escenario Maratón G7 simplificado:
    //   - Liquidación original con collected_total=100.000, fee=5.000+100+min
    //   - Entran nuevos pagos por 40.000
    //   - La complementaria debe:
    //     · collected_total = 40.000 (delta)
    //     · snapshot con fixed_fee_per_launch=0, fixed_fee_per_sale=0,
    //       min_guarantee=null, applies_on='collected'
    //     · retención = 30% × 40.000 = 12.000
    //     · owed_to_client = 40.000 − 12.000 = 28.000
    //     · parent_settlement_id = 'prev-most-recent'
    const { supabase, insertSpy } = makeFake({
      launches: [launchOk],
      settlement_rules: [ok(externalRule)],
      launch_settlements: [
        ok([
          // Orden desc por created_at — el más reciente es el parent
          {
            id: "prev-most-recent",
            collected_total: 100_000,
            created_at: "2026-02-01T00:00:00Z",
          },
        ]),
      ],
      sales: [ok([{ id: "s1", total_amount: 100_000 }])],
      payments: [ok([{ amount: 100_000 }, { amount: 40_000 }])],
    });

    const res = await createComplementarySettlement(supabase as never, {
      launchId: LAUNCH_ID,
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.newlyCollected).toBe(40_000);
    expect(res.previouslyCollected).toBe(100_000);
    expect(res.parentSettlementId).toBe("prev-most-recent");
    expect(res.payload.parent_settlement_id).toBe("prev-most-recent");
    expect(res.payload.collected_total).toBe(40_000);
    // 30% × 40.000 = 12.000, sin sumar fixed fees ni min_guarantee
    expect(res.payload.kingrow_retained).toBe(12_000);
    expect(res.payload.owed_to_client).toBe(28_000);
    // El snapshot congelado NO lleva fees ni min_guarantee
    expect(res.payload.settlement_rule_snapshot.fixed_fee_per_launch).toBe(0);
    expect(res.payload.settlement_rule_snapshot.fixed_fee_per_sale).toBe(0);
    expect(res.payload.settlement_rule_snapshot.min_guarantee).toBeNull();
    expect(res.payload.settlement_rule_snapshot.applies_on).toBe("collected");
    // El nombre se marca como complementaria para trazabilidad visual
    expect(res.payload.settlement_rule_snapshot.name).toContain("complementaria");
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("cadena: la nueva complementaria linkea al último cerrado (no al original)", async () => {
    // Original cerrada + 1 complementaria previa cerrada + nuevo delta.
    // El parent debe ser la complementaria previa, no el original.
    const { supabase } = makeFake({
      launches: [launchOk],
      settlement_rules: [ok(externalRule)],
      launch_settlements: [
        ok([
          // Desc por created_at — la comp1 es la más reciente
          {
            id: "comp-1",
            collected_total: 20_000,
            created_at: "2026-03-01T00:00:00Z",
          },
          {
            id: "orig",
            collected_total: 100_000,
            created_at: "2026-02-01T00:00:00Z",
          },
        ]),
      ],
      sales: [ok([{ id: "s1", total_amount: 100_000 }])],
      // Total actual = 100k + 20k (ya liquidado) + 15k nuevos = 135k
      payments: [ok([{ amount: 135_000 }])],
    });

    const res = await createComplementarySettlement(supabase as never, {
      launchId: LAUNCH_ID,
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.previouslyCollected).toBe(120_000); // 100k + 20k
    expect(res.newlyCollected).toBe(15_000);
    expect(res.parentSettlementId).toBe("comp-1");
    expect(res.payload.kingrow_retained).toBe(4_500); // 30% × 15k
  });
});
