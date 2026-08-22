import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchContactsByTag,
  syncTagProgressForCourse,
  type SupabaseLike,
} from "./ghl-tag-sync";

/**
 * Tests unitarios de la sync PULL de tags GHL (Fase C).
 *
 * Estrategia:
 *   - `fetchContactsByTag`: pura excepto por `global.fetch`. Mockeamos con vi.fn.
 *   - `syncTagProgressForCourse`: inyectamos un stub `SupabaseLike` que devuelve
 *     lo que necesita cada caso, y mockeamos fetch para el /contacts/search.
 *
 * No corre contra Supabase real ni GHL real — todo mockeado. Los smoke tests
 * de RLS de las migraciones 0147/0148 los corre el user en Studio.
 */

// ─── Helpers de mock ─────────────────────────────────────────────────────────

type QueryResult = { data: unknown; error: null | { message: string } };

interface MockTables {
  courses?: QueryResult;
  projects?: QueryResult;
  launches?: QueryResult;
  launch_secrets?: QueryResult;
  course_modules?: QueryResult;
  module_ghl_tag_mappings?: QueryResult;
  students?: QueryResult;
  cohorts?: QueryResult;
  enrollments?: QueryResult;
  student_module_progress_upserts?: QueryResult;
}

/**
 * Fluent builder que soporta la cadena que usa la sync:
 *   .from(table).select(...).eq(...).in(...).order(...).limit(...).maybeSingle()
 *
 * Cada método fluent devuelve `this` (menos maybeSingle/upsert que resuelven).
 * `then` deshabilitado — la sync siempre awaitea via el método terminal.
 *
 * Para `upsert` distinguimos la operación de student_module_progress.
 */
function makeStub(tables: MockTables): {
  client: SupabaseLike;
  upsertCalls: Array<Record<string, unknown>>;
} {
  const upsertCalls: Array<Record<string, unknown>> = [];

  const from = (name: string) => {
    const state: {
      table: string;
      isUpsert: boolean;
      upsertPayload: Record<string, unknown> | null;
    } = { table: name, isUpsert: false, upsertPayload: null };

    const resolveTerminal = (): QueryResult => {
      if (state.isUpsert) {
        upsertCalls.push({
          table: state.table,
          payload: state.upsertPayload,
        });
        return (
          tables.student_module_progress_upserts ?? {
            data: null,
            error: null,
          }
        );
      }
      const key = state.table as keyof MockTables;
      return tables[key] ?? { data: [], error: null };
    };

    // Objeto builder: cada método devuelve el mismo objeto (chainable) y el
    // objeto en sí es "thenable" — cuando la sync hace `await builder`, se
    // resuelve con el terminal.
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: () => Promise.resolve(resolveTerminal()),
      upsert: (payload: Record<string, unknown>) => {
        state.isUpsert = true;
        state.upsertPayload = payload;
        return Promise.resolve(resolveTerminal());
      },
      then: (onFulfilled: (v: QueryResult) => unknown) =>
        Promise.resolve(resolveTerminal()).then(onFulfilled),
    };
    return builder;
  };

  return { client: { from }, upsertCalls };
}

// Mock del fetch global. Cada test setea su propio comportamiento.
const originalFetch = global.fetch;
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn();
  global.fetch = fetchSpy as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

function mockFetchOnce(payload: unknown, ok = true): void {
  fetchSpy.mockResolvedValueOnce({
    ok,
    json: async () => payload,
  } as unknown as Response);
}

// ─── fetchContactsByTag ──────────────────────────────────────────────────────

describe("fetchContactsByTag", () => {
  it("una página con menos que pageLimit → corte inmediato", async () => {
    mockFetchOnce({
      contacts: [
        { id: "c1", email: "Alice@Example.com" },
        { id: "c2", email: "bob@example.com" },
      ],
    });

    const hits = await fetchContactsByTag({
      token: "pit-abc",
      locationId: "loc-xyz",
      tag: "mod-01-done",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(hits).toEqual([
      { id: "c1", email: "Alice@Example.com" },
      { id: "c2", email: "bob@example.com" },
    ]);

    // Verificar shape del request: POST /contacts/search + body correcto.
    const call = fetchSpy.mock.calls[0]!;
    expect(call[0]).toContain("/contacts/search");
    const init = call[1] as RequestInit;
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer pit-abc");
    expect(headers.Version).toBeDefined();
    const body = JSON.parse(init.body as string);
    expect(body.locationId).toBe("loc-xyz");
    expect(body.pageLimit).toBe(100);
    expect(body.filters).toEqual([
      { field: "tags", operator: "contains", value: "mod-01-done" },
    ]);
  });

  it("paginación: sigue mientras la página llena y trae searchAfter", async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => ({
      id: `c${i}`,
      email: `u${i}@x.com`,
    }));
    const secondPage = [{ id: "c100", email: "u100@x.com" }];

    mockFetchOnce({ contacts: fullPage, searchAfter: [1700000000, "c99"] });
    mockFetchOnce({ contacts: secondPage });

    const hits = await fetchContactsByTag({
      token: "t",
      locationId: "loc",
      tag: "tagA",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(hits.length).toBe(101);

    const secondCallBody = JSON.parse(
      (fetchSpy.mock.calls[1]![1] as RequestInit).body as string,
    );
    expect(secondCallBody.searchAfter).toEqual([1700000000, "c99"]);
  });

  it("dedup: contactos repetidos entre páginas cuentan una sola vez", async () => {
    const page = Array.from({ length: 100 }, (_, i) => ({
      id: `c${i}`,
      email: null,
    }));
    // Segunda página: los mismos ids que la primera → todos duplicados →
    // addedThisPage=0 corta la paginación.
    mockFetchOnce({ contacts: page, searchAfter: ["x"] });
    mockFetchOnce({ contacts: page });

    const hits = await fetchContactsByTag({
      token: "t",
      locationId: "loc",
      tag: "tagA",
    });

    expect(hits.length).toBe(100);
  });

  it("respuesta 4xx → corta silencioso y devuelve lo que tenía", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "unauthorized" }),
    } as unknown as Response);

    const hits = await fetchContactsByTag({
      token: "t",
      locationId: "loc",
      tag: "tagA",
    });

    expect(hits).toEqual([]);
  });

  it("respuesta con array `data` en vez de `contacts` también funciona", async () => {
    mockFetchOnce({ data: [{ id: "c1", email: "a@b.com" }] });

    const hits = await fetchContactsByTag({
      token: "t",
      locationId: "loc",
      tag: "tagA",
    });

    expect(hits).toEqual([{ id: "c1", email: "a@b.com" }]);
  });
});

// ─── syncTagProgressForCourse ────────────────────────────────────────────────

describe("syncTagProgressForCourse", () => {
  const COURSE_ID = "course-1";
  const PROJECT_ID = "project-1";
  const MODULE_ID = "module-1";
  const ENROLLMENT_ID = "enr-1";
  const STUDENT_ID = "stu-1";

  function baseTables(overrides: MockTables = {}): MockTables {
    return {
      courses: {
        data: {
          id: COURSE_ID,
          project_id: PROJECT_ID,
          progress_source: "ghl_tags",
        },
        error: null,
      },
      projects: {
        data: { id: PROJECT_ID, ghl_location_id: "loc-1" },
        error: null,
      },
      launches: { data: [{ id: "launch-1" }], error: null },
      launch_secrets: {
        data: [{ secret: "pit-xxx", updated_at: "2026-08-01" }],
        error: null,
      },
      course_modules: { data: [{ id: MODULE_ID }], error: null },
      module_ghl_tag_mappings: {
        data: [
          {
            id: "mapping-1",
            course_module_id: MODULE_ID,
            ghl_tag: "mod-01-done",
          },
        ],
        error: null,
      },
      students: {
        data: [{ id: STUDENT_ID, email: "student@example.com" }],
        error: null,
      },
      cohorts: { data: [{ id: "cohort-1" }], error: null },
      enrollments: {
        data: [{ id: ENROLLMENT_ID, student_id: STUDENT_ID }],
        error: null,
      },
      student_module_progress_upserts: { data: null, error: null },
      ...overrides,
    };
  }

  it("match happy path: contacto con email → upsert progress", async () => {
    mockFetchOnce({
      contacts: [
        { id: "ghl-1", email: "student@example.com" },
      ],
    });

    const { client, upsertCalls } = makeStub(baseTables());
    const result = await syncTagProgressForCourse(COURSE_ID, client);

    expect(result).toEqual({
      tagsChecked: 1,
      contactsMatched: 1,
      progressUpserted: 1,
    });
    expect(upsertCalls).toHaveLength(1);
    const payload = upsertCalls[0]!.payload as Record<string, unknown>;
    expect(payload.enrollment_id).toBe(ENROLLMENT_ID);
    expect(payload.course_module_id).toBe(MODULE_ID);
    expect(payload.source).toBe("ghl_tag");
    expect(payload.source_ref).toBe("mod-01-done");
    expect(typeof payload.completed_at).toBe("string");
  });

  it("no match: contacto con email que no es alumno → no upserta", async () => {
    mockFetchOnce({
      contacts: [
        { id: "ghl-99", email: "otro@ajeno.com" },
      ],
    });

    const { client, upsertCalls } = makeStub(baseTables());
    const result = await syncTagProgressForCourse(COURSE_ID, client);

    expect(result.contactsMatched).toBe(0);
    expect(result.progressUpserted).toBe(0);
    expect(upsertCalls).toHaveLength(0);
  });

  it("contacto sin email → ignorado", async () => {
    mockFetchOnce({
      contacts: [{ id: "ghl-1", email: null }],
    });

    const { client, upsertCalls } = makeStub(baseTables());
    const result = await syncTagProgressForCourse(COURSE_ID, client);

    expect(result.contactsMatched).toBe(0);
    expect(upsertCalls).toHaveLength(0);
  });

  it("match case-insensitive por email", async () => {
    mockFetchOnce({
      contacts: [{ id: "ghl-1", email: "  STUDENT@example.com  " }],
    });

    const { client, upsertCalls } = makeStub(baseTables());
    const result = await syncTagProgressForCourse(COURSE_ID, client);

    expect(result.contactsMatched).toBe(1);
    expect(upsertCalls).toHaveLength(1);
  });

  it("sin location_id en el proyecto → skippedReason 'missing_location_id'", async () => {
    const tables = baseTables({
      projects: {
        data: { id: PROJECT_ID, ghl_location_id: null },
        error: null,
      },
    });
    const { client, upsertCalls } = makeStub(tables);
    const result = await syncTagProgressForCourse(COURSE_ID, client);

    expect(result.skippedReason).toBe("missing_location_id");
    expect(result.tagsChecked).toBe(0);
    expect(upsertCalls).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sin token GHL en ningún launch → skippedReason 'missing_token'", async () => {
    const tables = baseTables({
      launch_secrets: { data: [], error: null },
    });
    const { client, upsertCalls } = makeStub(tables);
    const result = await syncTagProgressForCourse(COURSE_ID, client);

    expect(result.skippedReason).toBe("missing_token");
    expect(upsertCalls).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sin mappings → skippedReason 'no_mappings'", async () => {
    const tables = baseTables({
      module_ghl_tag_mappings: { data: [], error: null },
    });
    const { client } = makeStub(tables);
    const result = await syncTagProgressForCourse(COURSE_ID, client);

    expect(result.skippedReason).toBe("no_mappings");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("mapping con tag vacío se ignora → skippedReason 'no_mappings'", async () => {
    const tables = baseTables({
      module_ghl_tag_mappings: {
        data: [
          {
            id: "mapping-x",
            course_module_id: MODULE_ID,
            ghl_tag: "   ",
          },
        ],
        error: null,
      },
    });
    const { client } = makeStub(tables);
    const result = await syncTagProgressForCourse(COURSE_ID, client);

    expect(result.skippedReason).toBe("no_mappings");
  });

  it("proyecto sin students → skippedReason 'no_students'", async () => {
    const tables = baseTables({
      students: { data: [], error: null },
    });
    const { client } = makeStub(tables);
    const result = await syncTagProgressForCourse(COURSE_ID, client);

    expect(result.skippedReason).toBe("no_students");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("curso sin enrollments activos → skippedReason 'no_active_enrollments'", async () => {
    const tables = baseTables({
      enrollments: { data: [], error: null },
    });
    const { client } = makeStub(tables);
    const result = await syncTagProgressForCourse(COURSE_ID, client);

    expect(result.skippedReason).toBe("no_active_enrollments");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("paginación GHL: 100 + más consume 2 requests y agrega solo lo nuevo", async () => {
    // Página 1: 100 contactos, ninguno matchea. Segunda página: 1 contacto que sí.
    const fullPage = Array.from({ length: 100 }, (_, i) => ({
      id: `c${i}`,
      email: `nomatch${i}@x.com`,
    }));
    mockFetchOnce({ contacts: fullPage, searchAfter: ["cursor"] });
    mockFetchOnce({
      contacts: [{ id: "ghl-match", email: "student@example.com" }],
    });

    const { client, upsertCalls } = makeStub(baseTables());
    const result = await syncTagProgressForCourse(COURSE_ID, client);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.contactsMatched).toBe(1);
    expect(result.progressUpserted).toBe(1);
    expect(upsertCalls).toHaveLength(1);
  });

  it("curso no encontrado → skippedReason 'course_not_found'", async () => {
    const tables = baseTables({
      courses: { data: null, error: null },
    });
    const { client } = makeStub(tables);
    const result = await syncTagProgressForCourse(COURSE_ID, client);

    expect(result.skippedReason).toBe("course_not_found");
  });
});
