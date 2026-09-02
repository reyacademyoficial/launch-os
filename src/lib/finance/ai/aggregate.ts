/**
 * Selectores PUROS sobre gastos ya convertidos a USD. Sin Supabase, sin
 * fechas implícitas: el caller pasa las rows y la ventana de meses.
 *
 * Mismo molde que `src/lib/finance/kpis.ts` — la lógica que decide "esto es
 * un gasto recurrente" o "esta categoría pesa 22%" vive acá y se testea con
 * literales, no adentro del builder de contexto de la IA.
 */

import {
  normalizeCategorySlug,
  type ExpenseBucket,
} from "../expense-categories";

import type {
  CategoryStat,
  ExpenseDetail,
  PersonPayrollStat,
  RecurringExpense,
} from "./types";

/** "YYYY-MM" de un `YYYY-MM-DD`. */
export function monthKeyOf(ymd: string): string {
  return ymd.slice(0, 7);
}

/**
 * Clave de agrupación para detectar recurrencia. Objetivo: que
 * "Netflix 09/2026", "netflix  ", y "NETFLIX - plan anual" NO se dispersen
 * en tres grupos distintos.
 *
 * Reglas: minúsculas, sin acentos, sin dígitos (los períodos y números de
 * factura son ruido), signos colapsados a espacio. Si al normalizar queda
 * vacío (una descripción que era solo un número), devolvemos la original
 * en minúsculas para no fusionar cosas no relacionadas bajo "".
 */
export function normalizeDescriptionKey(description: string): string {
  const stripped = description
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\d+/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped === "" ? description.trim().toLowerCase() : stripped;
}

// ═══════════════════════════════════════════════════════════════════════════
// Categorías
// ═══════════════════════════════════════════════════════════════════════════

export interface AggregateByCategoryOptions {
  /** Meses de la ventana ("YYYY-MM"), para el promedio mensual real. */
  readonly monthKeys: readonly string[];
  /** Mes de referencia para la columna "último mes". */
  readonly lastMonthKey: string;
  readonly labelBySlug: ReadonlyMap<string, string>;
  readonly bucketBySlug: ReadonlyMap<string, ExpenseBucket>;
}

/**
 * Agrupa gastos por categoría con las métricas que necesita un análisis de
 * exceso: total, peso relativo, promedio mensual y cuánto se gastó el
 * último mes (¿es un gasto vivo o una cola histórica?).
 *
 * `avgPerMonthUsd` divide por los meses de la VENTANA, no por los meses con
 * gasto — si algo se pagó una sola vez en 12 meses, su promedio mensual
 * tiene que reflejar eso y no inflarse.
 */
export function aggregateByCategory(
  expenses: readonly ExpenseDetail[],
  opts: AggregateByCategoryOptions,
): CategoryStat[] {
  const windowMonths = Math.max(opts.monthKeys.length, 1);

  interface Acc {
    total: number;
    count: number;
    months: Set<string>;
    lastMonth: number;
  }
  const acc = new Map<string, Acc>();

  let grandTotal = 0;
  for (const e of expenses) {
    const slug = normalizeCategorySlug(e.category);
    const key = slug === "" ? "sin-categoria" : slug;
    let cur = acc.get(key);
    if (!cur) {
      cur = { total: 0, count: 0, months: new Set(), lastMonth: 0 };
      acc.set(key, cur);
    }
    const mk = monthKeyOf(e.expenseDate);
    cur.total += e.netUsd;
    cur.count += 1;
    cur.months.add(mk);
    if (mk === opts.lastMonthKey) cur.lastMonth += e.netUsd;
    grandTotal += e.netUsd;
  }

  const rows: CategoryStat[] = [];
  for (const [slug, a] of acc) {
    rows.push({
      slug,
      label: opts.labelBySlug.get(slug) ?? capitalize(slug.replace(/-/g, " ")),
      bucket: opts.bucketBySlug.get(slug) ?? "operating",
      totalUsd: a.total,
      count: a.count,
      monthsWithSpend: a.months.size,
      avgPerMonthUsd: a.total / windowMonths,
      lastMonthUsd: a.lastMonth,
      // Un total 0 (o negativo por notas de crédito) no puede producir NaN /
      // Infinity en el share — la IA lo leería como dato y lo citaría.
      share: grandTotal > 0 ? a.total / grandTotal : 0,
    });
  }
  return rows.sort((a, b) => b.totalUsd - a.totalUsd);
}

// ═══════════════════════════════════════════════════════════════════════════
// Recurrencia
// ═══════════════════════════════════════════════════════════════════════════

export interface DetectRecurringOptions {
  /** Mínimo de meses distintos para considerarlo recurrente. Default 3. */
  readonly minMonths?: number;
  /** Corte de la lista devuelta, por total descendente. Default 25. */
  readonly limit?: number;
}

/**
 * Detecta gastos que se repiten mes a mes bajo la misma descripción
 * normalizada. Es la señal principal para responder "¿qué estoy pagando
 * todos los meses que podría cortar?" — un gasto único de $5.000 no es un
 * candidato a recorte estructural; una suscripción de $300 × 12 sí.
 *
 * `months` cuenta meses DISTINTOS, no filas: dos facturas del mismo mes no
 * hacen a un gasto más recurrente.
 */
export function detectRecurringExpenses(
  expenses: readonly ExpenseDetail[],
  opts: DetectRecurringOptions = {},
): RecurringExpense[] {
  const minMonths = opts.minMonths ?? 3;
  const limit = opts.limit ?? 25;

  interface Acc {
    description: string;
    category: string | null;
    supplierName: string | null;
    months: Set<string>;
    total: number;
    min: number;
    max: number;
    lastYmd: string;
    lastUsd: number;
  }
  const acc = new Map<string, Acc>();

  for (const e of expenses) {
    const key = normalizeDescriptionKey(e.description);
    if (key === "") continue;
    let cur = acc.get(key);
    if (!cur) {
      cur = {
        description: e.description.trim(),
        category: e.category,
        supplierName: e.supplierName,
        months: new Set(),
        total: 0,
        min: e.netUsd,
        max: e.netUsd,
        lastYmd: e.expenseDate,
        lastUsd: e.netUsd,
      };
      acc.set(key, cur);
    }
    cur.months.add(monthKeyOf(e.expenseDate));
    cur.total += e.netUsd;
    if (e.netUsd < cur.min) cur.min = e.netUsd;
    if (e.netUsd > cur.max) cur.max = e.netUsd;
    // La fila más reciente define descripción/categoría/proveedor mostrados:
    // si el gasto se recategorizó, queremos la clasificación vigente.
    if (e.expenseDate >= cur.lastYmd) {
      cur.lastYmd = e.expenseDate;
      cur.lastUsd = e.netUsd;
      cur.description = e.description.trim();
      cur.category = e.category;
      cur.supplierName = e.supplierName;
    }
  }

  const rows: RecurringExpense[] = [];
  for (const [key, a] of acc) {
    if (a.months.size < minMonths) continue;
    rows.push({
      key,
      description: a.description,
      category: a.category,
      supplierName: a.supplierName,
      months: a.months.size,
      totalUsd: a.total,
      avgUsd: a.total / a.months.size,
      minUsd: a.min,
      maxUsd: a.max,
      lastYmd: a.lastYmd,
      lastUsd: a.lastUsd,
    });
  }
  return rows.sort((a, b) => b.totalUsd - a.totalUsd).slice(0, limit);
}

// ═══════════════════════════════════════════════════════════════════════════
// Rankings simples
// ═══════════════════════════════════════════════════════════════════════════

/** Los N gastos individuales más caros de la ventana. */
export function topExpenses(
  expenses: readonly ExpenseDetail[],
  limit = 30,
): ExpenseDetail[] {
  return [...expenses].sort((a, b) => b.netUsd - a.netUsd).slice(0, limit);
}

/**
 * Gastos devengados sin pagar (`paid_at = null`), del más viejo al más
 * nuevo por vencimiento — los que primero generan problema.
 */
export function unpaidExpenses(
  expenses: readonly ExpenseDetail[],
  limit = 20,
): ExpenseDetail[] {
  return expenses
    .filter((e) => e.paidAt == null)
    .sort((a, b) => (a.dueDate ?? a.expenseDate).localeCompare(b.dueDate ?? b.expenseDate))
    .slice(0, limit);
}

export interface PayrollEntry {
  readonly personName: string;
  readonly totalUsd: number;
}

/** Nómina consolidada por persona sobre la ventana. */
export function aggregatePayrollByPerson(
  entries: readonly PayrollEntry[],
): PersonPayrollStat[] {
  const acc = new Map<string, { total: number; periods: number }>();
  for (const p of entries) {
    const cur = acc.get(p.personName) ?? { total: 0, periods: 0 };
    cur.total += p.totalUsd;
    cur.periods += 1;
    acc.set(p.personName, cur);
  }
  return Array.from(acc.entries())
    .map(([personName, a]) => ({
      personName,
      totalUsd: a.total,
      periods: a.periods,
      avgPerPeriodUsd: a.periods > 0 ? a.total / a.periods : 0,
    }))
    .sort((a, b) => b.totalUsd - a.totalUsd);
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
