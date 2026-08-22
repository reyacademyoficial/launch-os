import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * Reportería de sistemas (Fase E).
 *
 * monthlyAttendanceBySystem: agrega asistencias en clases de las cohortes
 * asignadas a un sistema, filtradas al mes calendario dado. La query hace 3
 * hops: cohorts (por system_id) → classes (por cohort_id + rango de fecha) →
 * attendance (por class_id). RLS filtra por project_id automáticamente.
 *
 * "Sesiones individuales" se leerán desde la app externa Nitro (Fase G) —
 * por ahora devolvemos null.
 */

export interface StudentAttendanceBucket {
  studentId: string;
  name: string;
  present: number;
  total: number;
}

export interface MonthlyAttendanceReport {
  systemId: string;
  year: number;
  month: number;
  classesCount: number;
  attendancesPresent: number;
  byStudent: StudentAttendanceBucket[];
  /** Placeholder — llenado cuando se conecte la app externa Nitro (Fase G). */
  individualSessions: number | null;
}

interface CohortRow {
  id: string;
}

interface ClassRow {
  id: string;
}

interface AttendanceRow {
  class_id: string;
  student_id: string;
  present: boolean;
}

interface StudentRow {
  id: string;
  name: string;
}

/**
 * Devuelve el reporte mensual de asistencias para un sistema en el mes dado.
 *
 * @param systemId - id de academia_systems
 * @param year - año calendario (ej: 2026)
 * @param month - mes 1-12
 */
export async function monthlyAttendanceBySystem(
  systemId: string,
  year: number,
  month: number,
): Promise<MonthlyAttendanceReport> {
  const supabase = await createClient();

  const { fromIso, toIso } = monthBoundsUtc(year, month);

  // 1) Cohortes del sistema.
  const cohortsRes = await supabase
    .from("cohorts")
    .select("id")
    .eq("system_id", systemId);
  const cohortRows = (cohortsRes.data ?? []) as unknown as CohortRow[];
  const cohortIds = cohortRows.map((c) => c.id);

  if (cohortIds.length === 0) {
    return {
      systemId,
      year,
      month,
      classesCount: 0,
      attendancesPresent: 0,
      byStudent: [],
      // TODO: Fase G llena esto
      individualSessions: null,
    };
  }

  // 2) Clases de esas cohortes en el rango [fromIso, toIso).
  const classesRes = await supabase
    .from("classes")
    .select("id")
    .in("cohort_id", cohortIds)
    .gte("scheduled_at", fromIso)
    .lt("scheduled_at", toIso);
  const classRows = (classesRes.data ?? []) as unknown as ClassRow[];
  const classIds = classRows.map((c) => c.id);

  if (classIds.length === 0) {
    return {
      systemId,
      year,
      month,
      classesCount: 0,
      attendancesPresent: 0,
      byStudent: [],
      // TODO: Fase G llena esto
      individualSessions: null,
    };
  }

  // 3) Asistencias de esas clases.
  const attendanceRes = await supabase
    .from("attendance")
    .select("class_id, student_id, present")
    .in("class_id", classIds);
  const attendanceRows =
    (attendanceRes.data ?? []) as unknown as AttendanceRow[];

  // Agregar por student.
  const perStudent = new Map<string, { present: number; total: number }>();
  let attendancesPresent = 0;
  for (const a of attendanceRows) {
    const bucket = perStudent.get(a.student_id) ?? { present: 0, total: 0 };
    bucket.total += 1;
    if (a.present) {
      bucket.present += 1;
      attendancesPresent += 1;
    }
    perStudent.set(a.student_id, bucket);
  }

  // Traer nombres.
  const studentIds = Array.from(perStudent.keys());
  const studentsRes =
    studentIds.length === 0
      ? { data: [] as StudentRow[] }
      : await supabase
          .from("students")
          .select("id, name")
          .in("id", studentIds);
  const studentRows = (studentsRes.data ?? []) as unknown as StudentRow[];
  const nameById = new Map<string, string>();
  for (const s of studentRows) nameById.set(s.id, s.name);

  const byStudent: StudentAttendanceBucket[] = studentIds
    .map((id) => {
      const b = perStudent.get(id)!;
      return {
        studentId: id,
        name: nameById.get(id) ?? "—",
        present: b.present,
        total: b.total,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    systemId,
    year,
    month,
    classesCount: classIds.length,
    attendancesPresent,
    byStudent,
    // TODO: Fase G llena esto
    individualSessions: null,
  };
}

/**
 * Devuelve los ISO strings de [inicio_mes, inicio_mes_siguiente) en UTC. Se
 * usa para el filtro half-open sobre classes.scheduled_at (timestamptz).
 */
function monthBoundsUtc(
  year: number,
  month: number,
): { fromIso: string; toIso: string } {
  const from = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const to = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  return { fromIso: from.toISOString(), toIso: to.toISOString() };
}
