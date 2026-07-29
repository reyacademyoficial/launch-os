import { describe, expect, it, vi } from "vitest";

import { resolveActiveRule } from "./rule-resolver";

/**
 * Fake supabase mínimo — mismo estilo que create.test.ts pero acá capturamos
 * los `.eq()` calls para poder verificar que resolveActiveRule filtra por
 * project_id. Ese es el fix del bloque 6c-b: la versión anterior buscaba
 * solo por launch_id y podía resolver a una regla de otro proyecto.
 */
interface FakeResponse {
  data: unknown;
  error: null | { message: string };
}

interface QueryLog {
  eq: { column: string; value: unknown }[];
  is: { column: string; value: unknown }[];
}

function makeFake(responses: FakeResponse[]) {
  const queries: QueryLog[] = [];
  let cursor = 0;

  function chain(): any {
    const log: QueryLog = { eq: [], is: [] };
    queries.push(log);
    const link: any = {
      select: () => link,
      eq: (col: string, val: unknown) => {
        log.eq.push({ column: col, value: val });
        return link;
      },
      is: (col: string, val: unknown) => {
        log.is.push({ column: col, value: val });
        return link;
      },
      maybeSingle: async () => {
        const r = responses[cursor++] ?? { data: null, error: null };
        return r;
      },
    };
    return link;
  }

  const from = vi.fn().mockImplementation((_table: string) => chain());
  return { supabase: { from } as unknown as never, queries, from };
}

const rule = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "rule-1",
  organization_id: "org-1",
  project_id: "project-A",
  launch_id: null,
  name: "regla",
  percent_of_collected: 30,
  fixed_fee_per_launch: 0,
  fixed_fee_per_sale: 0,
  min_guarantee: null,
  applies_on: "collected",
  active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...over,
});

describe("resolveActiveRule", () => {
  it("filtra por project_id en la búsqueda launch-scoped (fix del bug cross-project)", async () => {
    // Sin esta aserción, una regla mal asociada (launch_id = launchX pero
    // project_id = projectB) resolvería para un lanzamiento del projectA
    // cuando el resolver busca por launchX — la garantía la da el filtro
    // explícito. Es el bug que motivó extraer este archivo.
    const { supabase, queries } = makeFake([
      { data: null, error: null },
      { data: null, error: null },
    ]);

    await resolveActiveRule(supabase, {
      launchId: "launch-X",
      projectId: "project-A",
    });

    const launchScopedFilters = queries[0]!.eq.map((e) => e.column);
    expect(launchScopedFilters).toContain("project_id");
    expect(launchScopedFilters).toContain("launch_id");
    expect(launchScopedFilters).toContain("active");

    const launchScopedProjectFilter = queries[0]!.eq.find(
      (e) => e.column === "project_id",
    );
    expect(launchScopedProjectFilter?.value).toBe("project-A");
  });

  it("prioridad 1: si hay regla launch-scoped activa, la devuelve", async () => {
    const launchRule = rule({ launch_id: "launch-X", project_id: "project-A" });
    const { supabase } = makeFake([
      { data: launchRule, error: null },
      // Nunca llega a esta.
      { data: null, error: null },
    ]);

    const out = await resolveActiveRule(supabase, {
      launchId: "launch-X",
      projectId: "project-A",
    });

    expect(out).not.toBeNull();
    expect(out!.launch_id).toBe("launch-X");
  });

  it("prioridad 2: si no hay launch-scoped, cae a la default del proyecto", async () => {
    const defaultRule = rule({ launch_id: null, project_id: "project-A" });
    const { supabase, queries } = makeFake([
      { data: null, error: null },
      { data: defaultRule, error: null },
    ]);

    const out = await resolveActiveRule(supabase, {
      launchId: "launch-X",
      projectId: "project-A",
    });

    expect(out).not.toBeNull();
    expect(out!.launch_id).toBeNull();
    // La segunda query pide launch_id IS NULL (via .is), no .eq.
    expect(queries[1]!.is).toContainEqual({ column: "launch_id", value: null });
    // Y también filtra por project_id.
    const defaultProjectFilter = queries[1]!.eq.find(
      (e) => e.column === "project_id",
    );
    expect(defaultProjectFilter?.value).toBe("project-A");
  });

  it("ninguna activa (ni override ni default) → null", async () => {
    const { supabase } = makeFake([
      { data: null, error: null },
      { data: null, error: null },
    ]);

    const out = await resolveActiveRule(supabase, {
      launchId: "launch-X",
      projectId: "project-A",
    });

    expect(out).toBeNull();
  });
});
