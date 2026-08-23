import "server-only";

import { createClient } from "@/lib/supabase/server";

import {
  computeAccessExpiresAt,
  paymentPlanFromInstallmentCount,
  toYmd,
} from "./access-expiration";

/**
 * Resuelve la vigencia del acceso de un enrollment nuevo, según la regla
 * combinada override-curso + método-de-pago.
 *
 * Estrategia:
 *   1) Cargar el curso de la cohort (product_id + default_access_days)
 *   2) Buscar leads del proyecto con el email del student
 *   3) Buscar la sale más reciente de esos leads para el product del course
 *   4) Aplicar `computeAccessExpiresAt` con:
 *        - purchasedAt       = sale.closed_at (fallback: enrolledAt)
 *        - paymentPlan       = derivado de sale.installment_count
 *        - courseFixedAccessDays = course.default_access_days
 *
 * Devuelve `{ accessExpiresAt, saleId }`:
 *   - accessExpiresAt: YYYY-MM-DD para persistir en enrollments, o null.
 *   - saleId: la sale usada (para linkearla al enrollment), o null si no
 *     hubo match.
 *
 * Casos que retornan `{ null, null }`:
 *   - cohort sin curso asociado
 *   - student sin email (no podemos matchear con lead)
 *   - no hay lead con ese email en el proyecto
 *   - no hay sale del lead para ese product
 *   - Y el curso NO tiene default_access_days (nada que aplicar)
 * En cualquiera de esos casos, si el curso tiene default_access_days, el
 * override igual aplica y se devuelve la fecha calculada (con saleId null).
 */

export interface ResolveAccessExpiryOutput {
  readonly accessExpiresAt: string | null;
  readonly saleId: string | null;
}

interface CohortRow {
  readonly course_id: string | null;
}

interface CourseRow {
  readonly product_id: string;
  readonly default_access_days: number | null;
}

interface StudentRow {
  readonly project_id: string;
  readonly email: string | null;
}

interface LeadIdRow {
  readonly id: string;
}

interface SaleRow {
  readonly id: string;
  readonly closed_at: string | null;
  readonly installment_count: number | null;
}

export async function resolveAccessExpiryForEnrollment(input: {
  readonly studentId: string;
  readonly cohortId: string;
  readonly enrolledAt: string;
}): Promise<ResolveAccessExpiryOutput> {
  const supabase = await createClient();

  const [cohortRes, studentRes] = await Promise.all([
    supabase
      .from("cohorts")
      .select("course_id")
      .eq("id", input.cohortId)
      .maybeSingle(),
    supabase
      .from("students")
      .select("project_id, email")
      .eq("id", input.studentId)
      .maybeSingle(),
  ]);

  const cohort = cohortRes.data as CohortRow | null;
  const student = studentRes.data as StudentRow | null;

  if (!cohort?.course_id || !student) {
    return { accessExpiresAt: null, saleId: null };
  }

  const courseRes = await supabase
    .from("courses")
    .select("product_id, default_access_days")
    .eq("id", cohort.course_id)
    .maybeSingle();
  const course = courseRes.data as CourseRow | null;
  if (!course) return { accessExpiresAt: null, saleId: null };

  // Buscar sale por email match (student → lead → sale).
  let saleRow: SaleRow | null = null;
  const email = student.email?.trim().toLowerCase() ?? null;
  if (email && email.length > 0) {
    const leadsRes = await supabase
      .from("leads")
      .select("id")
      .eq("project_id", student.project_id)
      .ilike("email", email);
    const leadIds = ((leadsRes.data ?? []) as LeadIdRow[]).map((l) => l.id);

    if (leadIds.length > 0) {
      const salesRes = await supabase
        .from("sales")
        .select("id, closed_at, installment_count")
        .in("lead_id", leadIds)
        .eq("product_id", course.product_id)
        .order("closed_at", { ascending: false })
        .limit(1);
      const first = (salesRes.data ?? [])[0];
      saleRow = (first as SaleRow | undefined) ?? null;
    }
  }

  const purchasedAt = saleRow?.closed_at
    ? new Date(`${saleRow.closed_at.slice(0, 10)}T12:00:00Z`)
    : new Date(`${input.enrolledAt}T12:00:00Z`);

  const paymentPlan = paymentPlanFromInstallmentCount(
    saleRow?.installment_count ?? null,
  );

  const expiresAt = computeAccessExpiresAt({
    purchasedAt,
    paymentPlan,
    courseFixedAccessDays: course.default_access_days,
  });

  return {
    accessExpiresAt: expiresAt ? toYmd(expiresAt) : null,
    saleId: saleRow?.id ?? null,
  };
}
