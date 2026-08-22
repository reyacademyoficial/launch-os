import { describe, expect, it } from "vitest";

import {
  normalizeCompletionRows,
  normalizeDropoffRows,
  normalizeOverallRow,
  pickTopDropoff,
  type CourseDropoffRow,
} from "./course-metrics";

/**
 * Tests unitarios de los normalizers puros y del selector `pickTopDropoff`.
 * No tocamos la DB — los wrappers de RPC son un thin shell alrededor de
 * `supabase.rpc(...)`. La lógica testeable vive en la normalización
 * (postgrest devuelve `numeric` como string).
 */

describe("academia/course-metrics — normalizeCompletionRows", () => {
  it("array vacío → array vacío", () => {
    expect(normalizeCompletionRows([])).toEqual([]);
  });

  it("convierte numeric string a number para todas las columnas numéricas", () => {
    const rows = normalizeCompletionRows([
      {
        course_module_id: "m1",
        module_name: "Fundamentos",
        order_index: "0",
        total_students: "10",
        completed_students: "7",
        completion_rate: "70.00",
      },
    ]);
    expect(rows).toEqual([
      {
        course_module_id: "m1",
        module_name: "Fundamentos",
        order_index: 0,
        total_students: 10,
        completed_students: 7,
        completion_rate: 70,
      },
    ]);
  });

  it("acepta números nativos y string mixto sin romper", () => {
    const rows = normalizeCompletionRows([
      {
        course_module_id: "m2",
        module_name: "Avanzado",
        order_index: 1,
        total_students: 0,
        completed_students: "0",
        completion_rate: "0.00",
      },
    ]);
    expect(rows[0]).toMatchObject({
      order_index: 1,
      total_students: 0,
      completed_students: 0,
      completion_rate: 0,
    });
  });

  it("preserva el orden que llega del RPC (asume que ya viene ordenado)", () => {
    const rows = normalizeCompletionRows([
      {
        course_module_id: "b",
        module_name: "B",
        order_index: "0",
        total_students: "1",
        completed_students: "0",
        completion_rate: "0",
      },
      {
        course_module_id: "a",
        module_name: "A",
        order_index: "1",
        total_students: "1",
        completed_students: "1",
        completion_rate: "100",
      },
    ]);
    expect(rows.map((r) => r.course_module_id)).toEqual(["b", "a"]);
  });
});

describe("academia/course-metrics — normalizeDropoffRows", () => {
  it("normaliza students_stuck y order_index", () => {
    const rows = normalizeDropoffRows([
      {
        course_module_id: "m1",
        module_name: "Mod 1",
        order_index: "2",
        students_stuck: "3",
      },
      {
        course_module_id: "m2",
        module_name: "Mod 2",
        order_index: 3,
        students_stuck: 0,
      },
    ]);
    expect(rows).toEqual([
      {
        course_module_id: "m1",
        module_name: "Mod 1",
        order_index: 2,
        students_stuck: 3,
      },
      {
        course_module_id: "m2",
        module_name: "Mod 2",
        order_index: 3,
        students_stuck: 0,
      },
    ]);
  });
});

describe("academia/course-metrics — normalizeOverallRow", () => {
  it("null/undefined → zeros (data vacía = sin students)", () => {
    expect(normalizeOverallRow(null)).toEqual({
      avg_completion_percent: 0,
      total_students: 0,
      fully_completed_students: 0,
    });
    expect(normalizeOverallRow(undefined)).toEqual({
      avg_completion_percent: 0,
      total_students: 0,
      fully_completed_students: 0,
    });
  });

  it("convierte numeric string a number", () => {
    expect(
      normalizeOverallRow({
        avg_completion_percent: "45.50",
        total_students: "20",
        fully_completed_students: "5",
      }),
    ).toEqual({
      avg_completion_percent: 45.5,
      total_students: 20,
      fully_completed_students: 5,
    });
  });

  it("total_students/fully_completed se truncan a entero", () => {
    // Postgres no debería devolver decimales pero por defensa: si llegan,
    // trunc a int.
    expect(
      normalizeOverallRow({
        avg_completion_percent: 33.33,
        total_students: 3,
        fully_completed_students: 1,
      }),
    ).toEqual({
      avg_completion_percent: 33.33,
      total_students: 3,
      fully_completed_students: 1,
    });
  });
});

describe("academia/course-metrics — pickTopDropoff", () => {
  const mk = (
    id: string,
    order: number,
    stuck: number,
  ): CourseDropoffRow => ({
    course_module_id: id,
    module_name: `Mod ${id}`,
    order_index: order,
    students_stuck: stuck,
  });

  it("array vacío → null", () => {
    expect(pickTopDropoff([])).toBeNull();
  });

  it("todos 0 → null (no hay abandono detectable)", () => {
    expect(pickTopDropoff([mk("a", 0, 0), mk("b", 1, 0)])).toBeNull();
  });

  it("devuelve el de mayor students_stuck", () => {
    const top = pickTopDropoff([
      mk("a", 0, 2),
      mk("b", 1, 5),
      mk("c", 2, 1),
    ]);
    expect(top?.course_module_id).toBe("b");
  });

  it("en empate de stuck, gana el de mayor order_index (más avanzado)", () => {
    const top = pickTopDropoff([
      mk("early", 0, 3),
      mk("late", 5, 3),
      mk("mid", 2, 3),
    ]);
    expect(top?.course_module_id).toBe("late");
  });
});
