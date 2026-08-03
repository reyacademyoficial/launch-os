import type { InstallmentRow, PaymentRow } from "@/lib/commissions/types";

export type InstallmentState = "paid" | "partial" | "overdue" | "pending";

/** Umbral de cobertura mínima para considerar paga una cuota (50%). */
export const PAID_COVERAGE_THRESHOLD = 0.5;

export interface InstallmentStatus {
  installment: InstallmentRow;
  /** Monto absorbido por esta cuota desde el acumulado de la venta. */
  paid: number;
  /** Saldo restante = max(amount - paid, 0). */
  remaining: number;
  /** Días de atraso (positivo = vencido, 0 o negativo = al día). */
  daysOverdue: number;
  state: InstallmentState;
}

/**
 * Estado de cada cuota respecto a `today`. Modelo "acumulado de venta":
 * el saldo importa a nivel venta, no cuota por cuota. Sumamos TODOS los
 * payments (con o sin `installment_id`) y los distribuimos en orden por
 * `number` sobre las cuotas — al día si el total cubre lo esperado hasta
 * esa cuota (aunque los cobros nominales por cuota no cuadren uno a uno).
 *
 * Caso motivador: cuotas 300/300/300/300/300/300 (total 1800). El cliente
 * paga 300, 250, 350, 150, 450 = 1500. Con el modelo anterior las cuotas
 * 2-6 quedaban impagas por importe; con este, 1-5 quedan pagas porque el
 * acumulado (1500) cubre 5 cuotas y sólo la 6 queda pendiente.
 *
 * Reglas por cuota (ordenadas por `number`):
 *   - covered = clip(totalPagado - esperadoAntes, 0, amount).
 *   - paid: covered ≥ amount * 0.5. Media cuota ya vale como paga porque
 *     operativamente "al día" es lo que importa; el saldo residual queda
 *     visible en `remaining` para el operador que quiera cerrar el redondeo.
 *   - partial: covered > 0 y todavía no vencida.
 *   - overdue: covered < 0.5 * amount y (due_date + grace_days) < today.
 *   - pending: covered < 0.5 * amount y todavía no vencida.
 *
 * `graceDays` viene del sale (default 5 según migración 0043).
 *
 * FX: se asume que sale, cuotas y payments comparten moneda. La UI marca
 * "moneda distinta" cuando hay mismatch y ese caso queda fuera de este
 * cálculo (el operador ve el warning y ajusta).
 */
export function computeInstallmentStatuses(
  installments: ReadonlyArray<InstallmentRow>,
  payments: ReadonlyArray<PaymentRow>,
  graceDays: number,
  today: string,
): InstallmentStatus[] {
  let totalPaid = 0;
  for (const p of payments) totalPaid += Number(p.amount) || 0;

  let expectedBefore = 0;
  return installments.map((inst) => {
    const amount = Number(inst.amount);
    const covered = Math.max(0, Math.min(totalPaid - expectedBefore, amount));
    expectedBefore += amount;

    const remaining = Math.max(amount - covered, 0);
    const daysOverdue = daysBetween(today, inst.due_date) - graceDays;

    let state: InstallmentState;
    if (amount > 0 && covered >= amount * PAID_COVERAGE_THRESHOLD) {
      state = "paid";
    } else if (covered > 0 && daysOverdue <= 0) {
      state = "partial";
    } else if (daysOverdue > 0) {
      state = "overdue";
    } else {
      state = "pending";
    }

    return { installment: inst, paid: covered, remaining, daysOverdue, state };
  });
}

/**
 * Días entre dos fechas YYYY-MM-DD (a - b). Positivo si `a > b`. Se opera
 * en UTC para evitar off-by-one por timezone.
 */
function daysBetween(a: string, b: string): number {
  const da = parseDate(a);
  const db = parseDate(b);
  return Math.round((da - db) / (1000 * 60 * 60 * 24));
}

function parseDate(s: string): number {
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!);
}

/** Fecha AR de hoy en YYYY-MM-DD. Útil para SSR consistente. */
export function todayInAR(): string {
  const now = new Date();
  const ar = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const y = ar.getUTCFullYear();
  const m = String(ar.getUTCMonth() + 1).padStart(2, "0");
  const d = String(ar.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export interface SaleOverdueSummary {
  /** Suma de saldos vencidos: sum(status.remaining) donde state='overdue'. */
  overdueAmount: number;
  /** Cantidad de cuotas vencidas (con saldo > 0). */
  overdueCount: number;
  /** Próxima cuota con saldo > 0 (por due_date). Puede estar vencida o no. */
  nextDueDate: string | null;
  /** Cuota más atrasada — para clasificación del cliente. */
  maxDaysOverdue: number;
}

export function summarizeSaleOverdue(
  statuses: ReadonlyArray<InstallmentStatus>,
): SaleOverdueSummary {
  let overdueAmount = 0;
  let overdueCount = 0;
  let nextDueDate: string | null = null;
  let maxDaysOverdue = 0;

  for (const s of statuses) {
    if (s.state === "overdue") {
      overdueAmount += s.remaining;
      overdueCount += 1;
    }
    // "Próxima" = primera cuota que aún no cuenta como paga. Ignoramos el
    // saldo residual de cuotas ya marcadas paid (por el umbral del 50%) —
    // sino "próx vencimiento" mostraría la primera cuota con centavos
    // sueltos y no la primera realmente pendiente.
    if (s.state !== "paid") {
      if (!nextDueDate || s.installment.due_date < nextDueDate) {
        nextDueDate = s.installment.due_date;
      }
      if (s.daysOverdue > maxDaysOverdue) {
        maxDaysOverdue = s.daysOverdue;
      }
    }
  }

  return { overdueAmount, overdueCount, nextDueDate, maxDaysOverdue };
}

export type ClientClassification = "bueno" | "regular" | "malo";

/**
 * Clasifica al cliente por historial de vencimientos.
 *   - malo: 3+ cuotas vencidas alguna vez, o alguna vencida hoy con >15
 *     días de atraso.
 *   - regular: 1–2 cuotas vencidas alguna vez.
 *   - bueno: 0 vencidas jamás.
 *
 * "Vencida alguna vez" = una cuota que hoy sigue con saldo pendiente y
 * cuya due_date+grace_days ya pasó. Cuotas que se atrasaron pero se
 * pagaron completas no cuentan (no queda registro histórico de la mora,
 * es una simplificación consciente).
 */
export function classifyClient(
  statuses: ReadonlyArray<InstallmentStatus>,
): ClientClassification {
  let overdueEver = 0;
  let maxDaysOverdue = 0;

  for (const s of statuses) {
    if (s.state === "overdue") {
      overdueEver += 1;
      if (s.daysOverdue > maxDaysOverdue) maxDaysOverdue = s.daysOverdue;
    }
  }

  if (overdueEver >= 3 || maxDaysOverdue > 15) return "malo";
  if (overdueEver >= 1) return "regular";
  return "bueno";
}
