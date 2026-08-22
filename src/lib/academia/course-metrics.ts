import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * course-metrics — wrappers de las 3 RPCs de la migración 0152 (Fase F).
 *
 *  - rpc_course_module_completion_stats: por módulo, tasa de completion
 *  - rpc_course_dropoff: por módulo, cuántos alumnos quedaron atascados
 *  - rpc_course_overall_progress: 1 fila con % promedio + totales
 *
 * Todas las RPCs son SECURITY INVOKER — la RLS del caller aplica. Si el
 * user no tiene acceso al proyecto del curso, las funciones devuelven filas
 * vacías (o ceros) silenciosamente.
 *
 * Los valores `numeric` de Postgres llegan a JS como string via
 * postgrest-js. `toNum` los normaliza igual que el wrapper del leaderboard.
 */

// ─── Shapes de retorno ───────────────────────────────────────────────────────

export interface CourseModuleCompletionRow {
  course_module_id: string;
  module_name: string;
  order_index: number;
  total_students: number;
  completed_students: number;
  /** 0-100. 0 si no hay students. */
  completion_rate: number;
}

export interface CourseDropoffRow {
  course_module_id: string;
  module_name: string;
  order_index: number;
  students_stuck: number;
}

export interface CourseOverallProgress {
  /** 0-100. 0 si no hay students o no hay módulos. */
  avg_completion_percent: number;
  total_students: number;
  fully_completed_students: number;
}

// ─── Shapes crudas devueltas por postgrest ───────────────────────────────────

interface RpcCompletionRawRow {
  course_module_id: string;
  module_name: string;
  order_index: number | string;
  total_students: number | string;
  completed_students: number | string;
  completion_rate: number | string;
}

interface RpcDropoffRawRow {
  course_module_id: string;
  module_name: string;
  order_index: number | string;
  students_stuck: number | string;
}

interface RpcOverallRawRow {
  avg_completion_percent: number | string;
  total_students: number | string;
  fully_completed_students: number | string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function toNum(v: number | string | null | undefined): number {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function toInt(v: number | string | null | undefined): number {
  const n = toNum(v);
  return Math.trunc(n);
}

// ─── Normalizadores exportados (para tests + reutilización) ─────────────────

export function normalizeCompletionRows(
  rows: readonly RpcCompletionRawRow[],
): CourseModuleCompletionRow[] {
  return rows.map((r) => ({
    course_module_id: r.course_module_id,
    module_name: r.module_name,
    order_index: toInt(r.order_index),
    total_students: toInt(r.total_students),
    completed_students: toInt(r.completed_students),
    completion_rate: toNum(r.completion_rate),
  }));
}

export function normalizeDropoffRows(
  rows: readonly RpcDropoffRawRow[],
): CourseDropoffRow[] {
  return rows.map((r) => ({
    course_module_id: r.course_module_id,
    module_name: r.module_name,
    order_index: toInt(r.order_index),
    students_stuck: toInt(r.students_stuck),
  }));
}

export function normalizeOverallRow(
  row: RpcOverallRawRow | null | undefined,
): CourseOverallProgress {
  if (row == null) {
    return {
      avg_completion_percent: 0,
      total_students: 0,
      fully_completed_students: 0,
    };
  }
  return {
    avg_completion_percent: toNum(row.avg_completion_percent),
    total_students: toInt(row.total_students),
    fully_completed_students: toInt(row.fully_completed_students),
  };
}

/**
 * Del array de dropoff, devuelve el módulo con mayor `students_stuck`. Si
 * hay empate, gana el de mayor `order_index` (más avanzado). Si todo es 0,
 * devuelve null (no hay abandono detectable).
 */
export function pickTopDropoff(
  rows: readonly CourseDropoffRow[],
): CourseDropoffRow | null {
  let best: CourseDropoffRow | null = null;
  for (const r of rows) {
    if (r.students_stuck <= 0) continue;
    if (
      best == null ||
      r.students_stuck > best.students_stuck ||
      (r.students_stuck === best.students_stuck &&
        r.order_index > best.order_index)
    ) {
      best = r;
    }
  }
  return best;
}

// ─── Wrappers de RPC ────────────────────────────────────────────────────────

export async function getCourseModuleCompletionStats(
  courseId: string,
): Promise<CourseModuleCompletionRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "rpc_course_module_completion_stats" as never,
    { p_course_id: courseId } as never,
  );
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as RpcCompletionRawRow[];
  return normalizeCompletionRows(rows);
}

export async function getCourseDropoff(
  courseId: string,
): Promise<CourseDropoffRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "rpc_course_dropoff" as never,
    { p_course_id: courseId } as never,
  );
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as RpcDropoffRawRow[];
  return normalizeDropoffRows(rows);
}

export async function getCourseOverallProgress(
  courseId: string,
): Promise<CourseOverallProgress> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "rpc_course_overall_progress" as never,
    { p_course_id: courseId } as never,
  );
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as RpcOverallRawRow[];
  return normalizeOverallRow(rows[0] ?? null);
}
