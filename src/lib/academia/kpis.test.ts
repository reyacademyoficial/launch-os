import { describe, it, expect } from "vitest";

import {
  activeStudents,
  averageAttendance,
  certificationRate,
  completionRate,
  examPassRate,
  type AttendanceRow,
  type CertificateRow,
  type EnrollmentRow,
  type ExamRow,
  type StudentRow,
} from "./kpis";

describe("academia/kpis — activeStudents", () => {
  it("cuenta sólo status='active' (graduated e inactive no cuentan)", () => {
    const students: StudentRow[] = [
      { id: "1", status: "active" },
      { id: "2", status: "active" },
      { id: "3", status: "graduated" },
      { id: "4", status: "inactive" },
      { id: "5", status: "active" },
    ];
    expect(activeStudents(students)).toBe(3);
  });

  it("array vacío → 0", () => {
    expect(activeStudents([])).toBe(0);
  });

  it("ninguno activo → 0", () => {
    const students: StudentRow[] = [
      { id: "1", status: "graduated" },
      { id: "2", status: "inactive" },
    ];
    expect(activeStudents(students)).toBe(0);
  });
});

describe("academia/kpis — completionRate", () => {
  it("null cuando no hay enrollments (sin base)", () => {
    expect(completionRate([])).toBeNull();
  });

  it("cuenta sólo status='completed' sobre el total", () => {
    const enrollments: EnrollmentRow[] = [
      { status: "completed" },
      { status: "completed" },
      { status: "active" },
      { status: "dropped" },
    ];
    expect(completionRate(enrollments)).toBe(50); // 2/4
  });

  it("0 completados → 0% (no null — la base existe)", () => {
    const enrollments: EnrollmentRow[] = [
      { status: "active" },
      { status: "dropped" },
    ];
    expect(completionRate(enrollments)).toBe(0);
  });

  it("todos completados → 100%", () => {
    const enrollments: EnrollmentRow[] = [
      { status: "completed" },
      { status: "completed" },
    ];
    expect(completionRate(enrollments)).toBe(100);
  });
});

describe("academia/kpis — averageAttendance", () => {
  it("null cuando no hay registros", () => {
    expect(averageAttendance([])).toBeNull();
  });

  it("cuenta presentes sobre el total de filas", () => {
    const records: AttendanceRow[] = [
      { present: true },
      { present: true },
      { present: false },
      { present: true },
    ];
    expect(averageAttendance(records)).toBe(75); // 3/4
  });

  it("nadie presente → 0%", () => {
    const records: AttendanceRow[] = [
      { present: false },
      { present: false },
    ];
    expect(averageAttendance(records)).toBe(0);
  });

  it("todos presentes → 100%", () => {
    const records: AttendanceRow[] = [{ present: true }, { present: true }];
    expect(averageAttendance(records)).toBe(100);
  });
});

describe("academia/kpis — examPassRate", () => {
  it("null cuando no hay exámenes corregidos", () => {
    expect(examPassRate([])).toBeNull();
    expect(examPassRate([{ passed: null }, { passed: null }])).toBeNull();
  });

  it("excluye pendientes (passed=null) de ambos lados de la división", () => {
    const exams: ExamRow[] = [
      { passed: true },
      { passed: true },
      { passed: false },
      { passed: null }, // pendiente — no cuenta
      { passed: null }, // pendiente — no cuenta
    ];
    // 2 passed / 3 graded = 66.66...%
    expect(examPassRate(exams)).toBeCloseTo((2 / 3) * 100, 5);
  });

  it("todos aprobados → 100%", () => {
    const exams: ExamRow[] = [{ passed: true }, { passed: true }];
    expect(examPassRate(exams)).toBe(100);
  });

  it("todos desaprobados → 0% (no null)", () => {
    const exams: ExamRow[] = [{ passed: false }, { passed: false }];
    expect(examPassRate(exams)).toBe(0);
  });
});

describe("academia/kpis — certificationRate", () => {
  it("null cuando totalStudents = 0 (o negativo)", () => {
    expect(certificationRate([], 0)).toBeNull();
    expect(certificationRate([], -1)).toBeNull();
  });

  it("cuenta students únicos con al menos 1 cert", () => {
    const certs: CertificateRow[] = [
      { student_id: "s1" },
      { student_id: "s1" }, // mismo student — no duplica
      { student_id: "s2" },
      { student_id: "s3" },
    ];
    expect(certificationRate(certs, 10)).toBe(30); // 3/10
  });

  it("sin certificados → 0%", () => {
    expect(certificationRate([], 5)).toBe(0);
  });

  it("todos los students certificados → 100%", () => {
    const certs: CertificateRow[] = [
      { student_id: "s1" },
      { student_id: "s2" },
      { student_id: "s3" },
    ];
    expect(certificationRate(certs, 3)).toBe(100);
  });

  it("más certs únicos que students totales → >100% (edge, no clamp)", () => {
    // Puede pasar si el caller pasó un total desactualizado. No clampeamos
    // — devolvemos lo que es, mismo criterio que retentionRate negativa.
    const certs: CertificateRow[] = [
      { student_id: "s1" },
      { student_id: "s2" },
    ];
    expect(certificationRate(certs, 1)).toBe(200);
  });
});
