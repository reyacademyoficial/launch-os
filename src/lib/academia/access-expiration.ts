/**
 * Cálculo de `enrollments.access_expires_at` — regla de vigencia del acceso
 * del alumno a un curso.
 *
 * Reglas (spec 2026-08-22):
 *
 * 1) OVERRIDE por curso: si `courses.default_access_days` está seteado a un
 *    número positivo, esa vigencia siempre gana. Sirve para cursos como
 *    Nitro que "sí o sí" duran 1 año independientemente de cómo se pagó.
 *
 * 2) Regla por método de pago (cuando no hay override):
 *      - Pago único         → sin vencimiento (null)
 *      - En cuotas          → 365 días desde purchased_at
 *      - Sin info de venta  → sin vencimiento (null) — no podemos calcular
 *
 * Puro. Sin DB, sin next/headers — testeable en vitest. Los helpers
 * server-side viven en `access-expiration-server.ts`.
 */

export type PaymentPlan = "single" | "installments";

export interface ComputeAccessExpiryInput {
  /** Fecha de compra (sale.closed_at) o de inscripción si no hay venta. */
  readonly purchasedAt: Date;
  /**
   * Modalidad de pago derivada de la venta. `null` si no hay venta o si el
   * dato es desconocido — en ese caso no calculamos vigencia.
   */
  readonly paymentPlan: PaymentPlan | null;
  /**
   * Override por curso (courses.default_access_days). Si es un número > 0,
   * pisa la regla por método de pago. `null` o 0 → se aplica la regla.
   */
  readonly courseFixedAccessDays: number | null;
}

const DAYS_FOR_INSTALLMENTS = 365;

/**
 * Devuelve la fecha en la que el alumno pierde acceso, o `null` si no
 * corresponde vencimiento (pago único sin override, o venta desconocida).
 */
export function computeAccessExpiresAt(
  input: ComputeAccessExpiryInput,
): Date | null {
  const { purchasedAt, paymentPlan, courseFixedAccessDays } = input;

  // Override: vigencia fija del curso.
  if (
    typeof courseFixedAccessDays === "number" &&
    Number.isFinite(courseFixedAccessDays) &&
    courseFixedAccessDays > 0
  ) {
    return addDays(purchasedAt, Math.trunc(courseFixedAccessDays));
  }

  // Sin venta → no computable.
  if (paymentPlan === null) return null;

  // Pago único → sin vencimiento.
  if (paymentPlan === "single") return null;

  // Cuotas → 1 año.
  return addDays(purchasedAt, DAYS_FOR_INSTALLMENTS);
}

/**
 * Deriva el `PaymentPlan` desde `sales.installment_count`.
 * count = 1  → 'single'
 * count > 1  → 'installments'
 * count <= 0 o no numérico → null (defensa; en la práctica el CHECK del
 * schema no permite < 1, pero devolvemos null por si vino corrupto).
 */
export function paymentPlanFromInstallmentCount(
  count: number | null | undefined,
): PaymentPlan | null {
  if (typeof count !== "number" || !Number.isFinite(count)) return null;
  if (count < 1) return null;
  if (count === 1) return "single";
  return "installments";
}

/**
 * Formatea una fecha a YYYY-MM-DD (formato date de Postgres). Usá esto
 * cuando la fecha va a `enrollments.access_expires_at`.
 * Toma la fecha en UTC para evitar sorpresas de timezone al persistir.
 */
export function toYmd(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}
