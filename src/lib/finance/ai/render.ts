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
 * Es una función pura: entra el snapshot, sale un string. Testeable.
 */

import type { FinanceSnapshot } from "./types";

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

export function renderFinanceSnapshot(s: FinanceSnapshot): string {
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
  out.push("", "## Gastos por categoría (ventana completa)");
  if (s.categories.length === 0) {
    out.push("Sin gastos cargados en la ventana.");
  } else {
    out.push(
      "categoria | bucket_pyl | total | %_del_gasto | cant | meses_con_gasto | promedio_mensual | ultimo_mes_cerrado",
    );
    for (const c of s.categories) {
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
  }

  // ─── Recurrentes ─────────────────────────────────────────────────────
  out.push(
    "",
    `## Gastos recurrentes (misma descripción en 3+ meses distintos)`,
  );
  if (s.recurring.length === 0) {
    out.push("No se detectaron gastos recurrentes en la ventana.");
  } else {
    out.push(
      "descripcion | categoria | proveedor | meses | total | promedio_mensual | min | max | ultimo (fecha/monto)",
    );
    for (const r of s.recurring) {
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

  // ─── Avisos ──────────────────────────────────────────────────────────
  if (s.warnings.length > 0) {
    out.push("", "## Avisos de calidad de dato");
    for (const w of s.warnings) out.push(`- ${w}`);
  }

  return out.join("\n");
}
