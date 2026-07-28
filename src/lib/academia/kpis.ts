/**
 * KPIs de academia — funciones puras, sin acceso a DB, sin server-only.
 *
 * Input: rows con shape de DB (snake_case) — se pueden pasar directo de
 * Supabase. Output: numbers o null. `null` significa "sin base para
 * calcular" (denominador 0), que la UI debería mostrar como "—" en vez de
 * NaN/Infinity. Mismo patrón que kpis.ts (showRate / closeRate).
 *
 * Ratios de tasa devuelven porcentaje 0–100, consistente con showRate /
 * closeRate del launch. La UI no tiene que multiplicar × 100.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Shapes mínimos — sólo los campos que cada KPI necesita. Cada caller
// puede pasarle un shape más grande (row de DB) y TS acepta por structural
// typing.
// ═══════════════════════════════════════════════════════════════════════════

export interface StudentRow {
  id: string;
  status: string;
}

export interface EnrollmentRow {
  status: string;
}

export interface AttendanceRow {
  present: boolean;
}

export interface ExamRow {
  /** Puede ser null si el examen está pendiente de corrección. */
  passed: boolean | null;
}

export interface CertificateRow {
  student_id: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1) activeStudents — cuántos students están cursando (status='active').
//    "graduated" e "inactive" NO cuentan. La definición operativa "activo"
//    es la que aparece en la spec: matriculado y cursando ahora.
// ═══════════════════════════════════════════════════════════════════════════
export function activeStudents(students: readonly StudentRow[]): number {
  return students.reduce((n, s) => (s.status === "active" ? n + 1 : n), 0);
}

// ═══════════════════════════════════════════════════════════════════════════
// 2) completionRate — % de enrollments que llegaron a status='completed'.
//    Base = todas las enrollments pasadas (active + completed + dropped +
//    suspended). Sin base → null (no hay % que reportar).
//
//    Nota: NO usamos progress_percent para esto. La "finalización" es un
//    hito discreto (el operador marca completed cuando el alumno terminó
//    el curso), no un promedio ponderado.
// ═══════════════════════════════════════════════════════════════════════════
export function completionRate(
  enrollments: readonly EnrollmentRow[],
): number | null {
  if (enrollments.length === 0) return null;
  const completed = enrollments.reduce(
    (n, e) => (e.status === "completed" ? n + 1 : n),
    0,
  );
  return (completed / enrollments.length) * 100;
}

// ═══════════════════════════════════════════════════════════════════════════
// 3) averageAttendance — % de asistencia sobre los registros existentes.
//    Cada row de attendance es un check-in (present true/false). El
//    denominador es la cantidad de FILAS, no de clases-esperadas: la spec
//    trata "no registrado" como distinto de "ausente" (decisión de UX).
//
//    Sin registros → null.
// ═══════════════════════════════════════════════════════════════════════════
export function averageAttendance(
  records: readonly AttendanceRow[],
): number | null {
  if (records.length === 0) return null;
  const present = records.reduce((n, r) => (r.present ? n + 1 : n), 0);
  return (present / records.length) * 100;
}

// ═══════════════════════════════════════════════════════════════════════════
// 4) examPassRate — % de exámenes con `passed=true` sobre los CORREGIDOS.
//    Los exams con passed=null (pendientes de corrección) se excluyen de
//    ambos lados de la división — no cuentan como aprobados ni desaprobados.
//    Sin exámenes corregidos → null.
// ═══════════════════════════════════════════════════════════════════════════
export function examPassRate(exams: readonly ExamRow[]): number | null {
  let graded = 0;
  let passed = 0;
  for (const e of exams) {
    if (e.passed === null) continue;
    graded++;
    if (e.passed) passed++;
  }
  if (graded === 0) return null;
  return (passed / graded) * 100;
}

// ═══════════════════════════════════════════════════════════════════════════
// 5) certificationRate — % de students que tienen AL MENOS 1 certificado.
//    Un student puede tener varios certs (multi-course); igual cuenta como
//    1 en el numerador. Sin students → null.
//
//    totalStudents es un arg explícito para no obligar al caller a cargar
//    la lista entera cuando ya tiene el count.
// ═══════════════════════════════════════════════════════════════════════════
export function certificationRate(
  certificates: readonly CertificateRow[],
  totalStudents: number,
): number | null {
  if (totalStudents <= 0) return null;
  const uniqueStudents = new Set(certificates.map((c) => c.student_id));
  return (uniqueStudents.size / totalStudents) * 100;
}
