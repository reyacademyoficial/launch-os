/**
 * Snapshot → texto plano para el system prompt.
 *
 * Decisiones de formato pensadas para un LLM, no para un humano:
 *   · Números SIN separadores de miles. "1.234" en es-AR es mil doscientos
 *     treinta y cuatro, pero un modelo lo puede leer como 1,234 en inglés.
 *     Enteros crudos eliminan la ambigüedad.
 *   · Tablas en pipe: compactas y ordenadas, el modelo las lee bien.
 *   · Todo en USD y declarado como tal en el encabezado.
 *
 * ── Dos niveles de detalle ────────────────────────────────────────────────
 * El snapshot viaja en el system prompt de CADA request, así que es el costo
 * dominante de un hilo largo. `detail: "compact"` recorta las listas largas
 * (gastos individuales, impagos, nómina por persona) y deja los agregados.
 *
 * El criterio: a partir del segundo turno el detalle fino ya circuló por la
 * conversación — está en la respuesta anterior del asistente, que sigue en
 * el historial. Repetir las 30 filas de gastos en cada turno es pagar dos
 * veces por el mismo dato. Si el modelo necesita un detalle que no está en
 * la vista compacta, el bloque se lo dice explícitamente para que lo pida en
 * vez de inventarlo.
 *
 * Es una función pura: entra el snapshot, sale un string. Testeable.
 */

import type { FinanceSnapshot } from "./types";

export type SnapshotDetail = "full" | "compact";

export interface RenderOptions {
  /** "full" en el primer turno; "compact" de ahí en más. Default "full". */
  readonly detail?: SnapshotDetail;
}

/** Cortes de las listas en modo compacto — lo suficiente para razonar, no todo. */
const COMPACT_CATEGORIES = 8;
const COMPACT_RECURRING = 8;

/** Entero sin separadores. Un monto que no existe es "—", nunca 0. */
function n(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return String(Math.round(value));
}

/** Porcentaje con un decimal. Entrada en [0,1]. */
function pct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

export function renderFinanceSnapshot(
  s: FinanceSnapshot,
  opts: RenderOptions = {},
): string {
  const detail = opts.detail ?? "full";
  const compact = detail === "compact";
  const out: string[] = [];

  out.push("# SNAPSHOT FINANCIERO");
  out.push(
    `Generado: ${s.generatedAt.slice(0, 10)} · Ventana: ${s.windowFromYmd} → ${s.windowToYmd} (${s.windowMonths} meses) · Último mes cerrado: ${s.lastClosedMonthKey}`,
  );
  out.push(
    "Todos los importes están en USD, netos de IVA, redondeados a entero y SIN separadores de miles.",
  );
  if (s.fx.latestRate != null) {
    out.push(
      `Tasa ARS/USD más reciente cargada: ${s.fx.latestRate} (mes ${s.fx.latestRateMonth}).`,
    );
  }

  // ─── Totales de la ventana ───────────────────────────────────────────
  out.push("", "## Totales de la ventana");
  out.push(`- Ingreso: ${n(s.totals.revenueUsd)}`);
  out.push(
    `- Gastos (directos + operativos + impuestos): ${n(s.totals.expensesNetUsd)}`,
  );
  out.push(`- Nómina: ${n(s.totals.payrollUsd)}`);
  out.push(`- Comisiones al equipo: ${n(s.totals.payoutsUsd)}`);
  out.push(`- Utilidad neta: ${n(s.totals.netProfitUsd)}`);
  out.push(`- Margen neto: ${pct(s.totals.marginPct)}`);

  // ─── Posición ────────────────────────────────────────────────────────
  out.push("", "## Posición actual");
  out.push(
    `- Caja en bancos (${s.position.activeBanks} cuentas activas): ${n(s.position.cashUsd)}`,
  );
  out.push(`- Burn mensual (3 meses cerrados): ${n(s.position.burnMonthlyUsd)}`);
  out.push(
    `- Runway: ${
      s.position.runwayMonths == null
        ? `no calculable (${s.position.runwayReason})`
        : `${s.position.runwayMonths.toFixed(1)} meses`
    }`,
  );
  out.push(`- Cuentas por cobrar: ${n(s.position.receivableUsd)}`);
  out.push(`- Cuentas por pagar: ${n(s.position.payableUsd)}`);
  out.push(`- Patrimonio neto: ${n(s.position.netWorthUsd)}`);

  // ─── Serie mensual ───────────────────────────────────────────────────
  out.push("", "## P&L mensual");
  out.push("mes | ingreso | costos_directos | gastos_operativos | impuestos | nomina | utilidad");
  for (const m of s.monthly) {
    out.push(
      [
        m.key,
        n(m.revenueUsd),
        n(m.directUsd),
        n(m.operatingUsd),
        n(m.taxesUsd),
        n(m.payrollUsd),
        n(m.netProfitUsd),
      ].join(" | "),
    );
  }

  // ─── Categorías ──────────────────────────────────────────────────────
  const categories = compact
    ? s.categories.slice(0, COMPACT_CATEGORIES)
    : s.categories;
  const hiddenCategories = s.categories.length - categories.length;
  out.push(
    "",
    `## Gastos por categoría (ventana completa)${hiddenCategories > 0 ? ` — top ${categories.length}` : ""}`,
  );
  if (categories.length === 0) {
    out.push("Sin gastos cargados en la ventana.");
  } else {
    out.push(
      "categoria | bucket_pyl | total | %_del_gasto | cant | meses_con_gasto | promedio_mensual | ultimo_mes_cerrado",
    );
    for (const c of categories) {
      out.push(
        [
          c.label,
          c.bucket,
          n(c.totalUsd),
          pct(c.share),
          String(c.count),
          `${c.monthsWithSpend}/${s.windowMonths}`,
          n(c.avgPerMonthUsd),
          n(c.lastMonthUsd),
        ].join(" | "),
      );
    }
    if (hiddenCategories > 0) {
      out.push(`(+${hiddenCategories} categorías menores no listadas)`);
    }
  }

  // ─── Recurrentes ─────────────────────────────────────────────────────
  const recurring = compact
    ? s.recurring.slice(0, COMPACT_RECURRING)
    : s.recurring;
  const hiddenRecurring = s.recurring.length - recurring.length;
  out.push(
    "",
    `## Gastos recurrentes (misma descripción en 3+ meses distintos)${hiddenRecurring > 0 ? ` — top ${recurring.length}` : ""}`,
  );
  if (recurring.length === 0) {
    out.push("No se detectaron gastos recurrentes en la ventana.");
  } else {
    out.push(
      "descripcion | categoria | proveedor | meses | total | promedio_mensual | min | max | ultimo (fecha/monto)",
    );
    for (const r of recurring) {
      out.push(
        [
          r.description,
          r.category ?? "sin categoría",
          r.supplierName ?? "—",
          String(r.months),
          n(r.totalUsd),
          n(r.avgUsd),
          n(r.minUsd),
          n(r.maxUsd),
          `${r.lastYmd} / ${n(r.lastUsd)}`,
        ].join(" | "),
      );
    }
    if (hiddenRecurring > 0) {
      out.push(`(+${hiddenRecurring} recurrentes menores no listados)`);
    }
  }

  // ─── Bloques de detalle fino ─────────────────────────────────────────
  // Son las listas más caras en tokens y las menos consultadas después del
  // primer turno. En compacto se reemplazan por su resumen de una línea.
  if (compact) {
    out.push("", "## Detalle fino (no incluido en este turno)");
    out.push(
      `- Gastos individuales, impagos y nómina por persona se listaron al inicio del hilo. Resúmenes: ${s.topExpenses.length} gastos grandes (el mayor: ${n(s.topExpenses[0]?.netUsd ?? 0)}), ${s.unpaidExpenses.length} impagos, ${s.payrollByPerson.length} personas en nómina.`,
    );
    out.push(
      "- Si necesitás una fila puntual que no está acá, pedísela al usuario o remitite a lo que ya dijiste en el hilo. NO la inventes.",
    );
    return finish(out, s);
  }

  // ─── Top gastos ──────────────────────────────────────────────────────
  out.push("", "## Gastos individuales más grandes de la ventana");
  if (s.topExpenses.length === 0) {
    out.push("Sin gastos cargados.");
  } else {
    out.push("fecha | descripcion | categoria | proveedor | proyecto | monto_usd | moneda_original | pagado");
    for (const e of s.topExpenses) {
      out.push(
        [
          e.expenseDate,
          e.description,
          e.category ?? "sin categoría",
          e.supplierName ?? "—",
          e.projectName ?? "org",
          n(e.netUsd),
          `${e.currency} ${n(e.nativeGross)}`,
          e.paidAt ? "sí" : "no",
        ].join(" | "),
      );
    }
  }

  // ─── Nómina ──────────────────────────────────────────────────────────
  out.push("", "## Nómina por persona (ventana completa)");
  if (s.payrollByPerson.length === 0) {
    out.push("Sin nómina cargada en la ventana.");
  } else {
    out.push("persona | total | periodos | promedio_por_periodo");
    for (const p of s.payrollByPerson) {
      out.push(
        [
          p.personName,
          n(p.totalUsd),
          String(p.periods),
          n(p.avgPerPeriodUsd),
        ].join(" | "),
      );
    }
  }

  // ─── Impagos ─────────────────────────────────────────────────────────
  out.push("", "## Gastos devengados sin pagar (incluye anteriores a la ventana)");
  if (s.unpaidExpenses.length === 0) {
    out.push("No hay gastos impagos.");
  } else {
    out.push("vencimiento | fecha_gasto | descripcion | categoria | monto_usd");
    for (const e of s.unpaidExpenses) {
      out.push(
        [
          e.dueDate ?? "sin vencimiento",
          e.expenseDate,
          e.description,
          e.category ?? "sin categoría",
          n(e.netUsd),
        ].join(" | "),
      );
    }
  }

  return finish(out, s);
}

/**
 * Cierre común de ambos modos. Los avisos de calidad de dato van SIEMPRE:
 * son la diferencia entre un análisis confiable y uno que suena confiable.
 */
function finish(out: string[], s: FinanceSnapshot): string {
  if (s.warnings.length > 0) {
    out.push("", "## Avisos de calidad de dato");
    for (const w of s.warnings) out.push(`- ${w}`);
  }
  return out.join("\n");
}
