import type { InstallmentFrequency } from "@/lib/commissions/types";

export interface ScheduleEntry {
  number: number;
  due_date: string;
  amount: number;
}

/**
 * Reproduce en JS lo que hace `generate_installments_for_sale` en Postgres.
 * Sirve para el preview del modal de venta (mostrar las cuotas antes de
 * grabar) sin ida-vuelta al server. Debe quedar sincronizado con el SQL —
 * mismo reparto (round(total/N, 2) para las primeras N-1, la última
 * absorbe el redondeo).
 *
 * Reglas de frecuencia:
 *   - single: 1 cuota en `startDate`.
 *   - weekly: N cuotas cada 7 días desde `startDate`.
 *   - monthly: N cuotas cada mes desde `startDate`.
 *
 * `startDate` en formato YYYY-MM-DD (fecha de cierre de la venta). Se opera
 * en UTC para no arrastrar off-by-one por zona horaria.
 */
export function buildInstallmentSchedule({
  total,
  count,
  frequency,
  startDate,
}: {
  readonly total: number;
  readonly count: number;
  readonly frequency: InstallmentFrequency;
  readonly startDate: string;
}): ScheduleEntry[] {
  const n = Math.max(1, Math.trunc(count));
  const t = Number.isFinite(total) && total > 0 ? total : 0;

  if (n === 1) {
    return [{ number: 1, due_date: startDate, amount: round2(t) }];
  }

  const per = round2(t / n);
  const out: ScheduleEntry[] = [];
  let sum = 0;
  for (let i = 1; i <= n; i++) {
    const due = addFrequency(startDate, frequency, i - 1);
    const isLast = i === n;
    const amount = isLast ? round2(t - sum) : per;
    if (!isLast) sum += amount;
    out.push({ number: i, due_date: due, amount });
  }
  return out;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Suma N unidades de la frecuencia a una fecha YYYY-MM-DD, devolviendo
 * otra fecha YYYY-MM-DD. Todo en UTC para consistencia con `fmtDate`.
 *
 * Para `monthly` usa `setUTCMonth` — JS ajusta automáticamente cuando el día
 * no existe en el mes destino (ej: 31-ene + 1 mes → 28-feb / 29-feb). Es el
 * mismo comportamiento que `interval '1 month'` en Postgres, así que preview
 * y DB coinciden.
 */
function addFrequency(
  start: string,
  frequency: InstallmentFrequency,
  units: number,
): string {
  if (frequency === "single" || units === 0) return start;

  const [y, m, d] = start.split("-").map(Number);
  const base = new Date(Date.UTC(y!, m! - 1, d!));

  if (frequency === "weekly") {
    base.setUTCDate(base.getUTCDate() + units * 7);
  } else {
    base.setUTCMonth(base.getUTCMonth() + units);
  }

  const yy = base.getUTCFullYear();
  const mm = String(base.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(base.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}
