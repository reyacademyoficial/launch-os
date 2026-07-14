import type { InstallmentRow, PaymentRow } from "@/lib/commissions/types";

export type InstallmentState = "paid" | "partial" | "overdue" | "pending";

export interface InstallmentStatus {
  installment: InstallmentRow;
  /** Suma de payments linkeados a esta cuota. */
  paid: number;
  /** Saldo restante = max(amount - paid, 0). */
  remaining: number;
  /** Días de atraso (positivo = vencido, 0 o negativo = al día). */
  daysOverdue: number;
  state: InstallmentState;
}

/**
 * Estado de cada cuota respecto a `today`, incluyendo los payments que
 * tiene linkeados. `today` como YYYY-MM-DD (fecha en zona AR del server).
 *
 * Reglas:
 *   - paid: paid >= amount.
 *   - partial: 0 < paid < amount y todavía no vencida.
 *   - overdue: no paga, pasó (due_date + grace_days) < today.
 *   - pending: no paga y todavía no vencida.
 *
 * `graceDays` viene del sale (default 5 según migración 0043).
 */
export function computeInstallmentStatuses(
  installments: ReadonlyArray<InstallmentRow>,
  payments: ReadonlyArray<PaymentRow>,
  graceDays: number,
  today: string,
): InstallmentStatus[] {
  const paidByInst = new Map<string, number>();
  for (const p of payments) {
    if (!p.installment_id) continue;
    paidByInst.set(
      p.installment_id,
      (paidByInst.get(p.installment_id) ?? 0) + Number(p.amount),
    );
  }

  return installments.map((inst) => {
    const amount = Number(inst.amount);
    const paid = paidByInst.get(inst.id) ?? 0;
    const remaining = Math.max(amount - paid, 0);
    const daysOverdue = daysBetween(today, inst.due_date) - graceDays;

    let state: InstallmentState;
    if (paid >= amount && amount > 0) {
      state = "paid";
    } else if (paid > 0 && daysOverdue <= 0) {
      state = "partial";
    } else if (daysOverdue > 0) {
      state = "overdue";
    } else {
      state = "pending";
    }

    return { installment: inst, paid, remaining, daysOverdue, state };
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
    if (s.remaining > 0) {
      if (!nextDueDate || s.installment.due_date < nextDueDate) {
        nextDueDate = s.installment.due_date;
      }
    }
    if (s.daysOverdue > maxDaysOverdue && s.remaining > 0) {
      maxDaysOverdue = s.daysOverdue;
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
