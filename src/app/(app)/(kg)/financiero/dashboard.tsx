"use client";

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ActivityFeed } from "@/components/kg/activity-feed";
import { Breakdown } from "@/components/kg/breakdown";
import { ContextBar } from "@/components/kg/context-bar";
import { EmptyState } from "@/components/kg/empty-state";
import { HeroKpi, type HeroKpiTone } from "@/components/kg/hero-kpi";
import { IconFin } from "@/components/kg/icons";
import { useRegisterPageFilters } from "@/components/kg/page-menu";
import { Panel } from "@/components/kg/panel";
import { ProvenanceDrawer } from "@/components/kg/provenance-drawer";
import { SectionHeader } from "@/components/kg/section-header";
import { StatRow } from "@/components/kg/stat-row";
import { SupportKpi, type SupportKpiTone } from "@/components/kg/support-kpi";
import { fCount, fMoney, fMoneyK, fMonths, fPct } from "@/lib/finance/format";
import type { PeriodKey } from "@/lib/finance/period";
import { fmtUsd } from "@/lib/money";

import { PeriodPicker } from "./period-picker";

// ═══════════════════════════════════════════════════════════════════════════
// Shape del dato que la page (server component) pasa a este dashboard.
// Todo YA calculado por los selectores puros de src/lib/finance/. Este cliente
// solo compone. Manteniendo esta forma serializable, la page nunca cruza al
// cliente objetos con métodos.
// ═══════════════════════════════════════════════════════════════════════════

export interface FinancieroKpi {
  readonly value: number;
  readonly tone: HeroKpiTone;
  readonly parts: ReadonlyArray<{ readonly l: string; readonly v: number }>;
}

export interface RevenueSeries {
  readonly buckets: ReadonlyArray<{ readonly label: string; readonly revenue: number }>;
  /** null = no hay comparable → HeroKpi muestra "sin histórico comparable". */
  readonly delta: { readonly value: string; readonly dir: "up" | "down" } | null;
}

/**
 * Snapshot del KPI "Bancos" (Fila 1). Saldo consolidado en USD derivado de
 * `banks + payment_methods + payments + bank_movements` — mismos selectores
 * que /financiero/bancos. ARS convertido con la última tasa mensual a nivel
 * org. `totalUsd = null` cuando hay saldo ARS pero no hay tasa cargada.
 */
export interface BanksSnapshot {
  readonly totalUsd: number | null;
  readonly bankCount: number;
  readonly fxMonth: string | null;
  readonly needsFxRate: boolean;
}

/**
 * Runway ya CLASIFICADO por `classifyRunway` (src/lib/finance/runway.ts):
 * `months = null` cuando hay que mostrar em-dash; `reason` guía el hint y el
 * tono. El "∞" no se usa en ningún caso — burn = 0 se interpreta como "no hay
 * datos" y ese es su propio `reason`.
 */
export interface RunwaySnapshot {
  readonly months: number | null;
  readonly reason: "ok" | "stale-snapshot" | "no-burn-data" | "no-cash-data";
}

export interface ExpenseCategory {
  readonly label: string;
  readonly amount: number;
}

export interface LaunchSettlementRow {
  readonly launchName: string;
  readonly collected: number;
  readonly retained: number;
  readonly owed: number;
  readonly status: "abierta" | "liquidada" | "transferida";
}

export interface FinancieroDashboardData {
  readonly period: {
    readonly key: PeriodKey;
    readonly label: string;
    readonly rangeStart: string;
    readonly rangeEnd: string;
  };
  readonly counts: {
    readonly invoicesPending: number;
    readonly settlementsInPeriod: number;
    readonly expensesInPeriod: number;
    readonly payrollInPeriod: number;
    /** Facturas no anuladas sin project_id — defecto de carga a resolver. */
    readonly invoicesMissingProject: number;
    /** Facturas no anuladas sin launch_id — venta suelta legítima o vínculo faltante. */
    readonly invoicesMissingLaunch: number;
  };
  readonly stats: {
    readonly expensesTotal: number;
    readonly payrollTotal: number;
    readonly clientBalance: number;
    /** Σ neto de invoices pendientes 'group-volume' + 'third-party'. */
    readonly thirdPartyReceivable: number;
    readonly thirdPartyReceivableCount: number;
  };
  readonly revenue: FinancieroKpi;
  /**
   * Facturación del grupo (todas las empresas, bruto de origen). KPI de
   * CONTEXTO — NO se suma al ingreso ni al estado de resultados. La regla
   * del bloque 6b-rev es magnitudes separadas siempre.
   */
  readonly groupVolume: {
    readonly value: number;
    readonly count: number;
  };
  readonly revenueSeries: RevenueSeries;
  readonly netProfit: FinancieroKpi;
  readonly banks: BanksSnapshot;
  readonly runway: RunwaySnapshot;
  readonly burn: number;
  readonly cashFlow: FinancieroKpi;
  readonly margin: number | null;
  readonly ar: FinancieroKpi;
  readonly ap: FinancieroKpi;
  readonly equity: FinancieroKpi;
  readonly plParts: ReadonlyArray<{ readonly l: string; readonly v: number }>;
  readonly plNet: number;
  readonly expenseCategories: ReadonlyArray<ExpenseCategory>;
  readonly launchSettlements: ReadonlyArray<LaunchSettlementRow>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Registro de KPIs abribles (para el drawer). Cada uno saca su value/parts
// del data ya calculado — la fuente de verdad son los selectores.
// ═══════════════════════════════════════════════════════════════════════════

type ProvenanceKey =
  | "revenue"
  | "netProfit"
  | "cashFlow"
  | "ar"
  | "ap"
  | "equity";

// ═══════════════════════════════════════════════════════════════════════════
// Layout del bento — 12 col, gap 20, alignItems start. Responsive vía CSS.
// El artefacto lo hacía con `useEffect + resize listener`; lo evitamos:
// grid-template-columns con clamp/media queries mantiene el server component
// funcional y no fuerza rehydrate innecesario.
// ═══════════════════════════════════════════════════════════════════════════
const gridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
  gap: 20,
  alignItems: "start" as const,
};

function span(n: number): { gridColumn: string } {
  return { gridColumn: `span ${n}` };
}

export function FinancieroDashboard({ data }: { readonly data: FinancieroDashboardData }) {
  const [open, setOpen] = useState<ProvenanceKey | null>(null);

  // Registra el PeriodPicker en el bottom-sheet mobile de la shell. En desktop
  // se renderiza inline (abajo). El nodo se memoiza para que el efecto no
  // vuelva a firear en cada render — solo cuando cambian las fechas del rango.
  const mobileFilters = useMemo(
    () => (
      <PeriodPicker
        fromYmd={data.period.rangeStart}
        toYmd={data.period.rangeEnd}
      />
    ),
    [data.period.rangeStart, data.period.rangeEnd],
  );
  useRegisterPageFilters(mobileFilters);

  const openDetail = useMemo(() => {
    if (!open) return null;
    switch (open) {
      case "revenue":
        return {
          title: "Ingreso de Kingrow",
          value: fMoney(data.revenue.value),
          parts: data.revenue.parts,
          fmt: fMoney,
          halo: "var(--kg-positive-500)",
        };
      case "netProfit":
        return {
          title: "Utilidad neta",
          value: fMoney(data.netProfit.value),
          parts: data.netProfit.parts,
          fmt: fMoney,
          halo:
            data.netProfit.value >= 0
              ? "var(--kg-positive-500)"
              : "var(--kg-negative-500)",
        };
      case "cashFlow":
        return {
          title: "Flujo de caja",
          value: fMoney(data.cashFlow.value),
          parts: data.cashFlow.parts,
          fmt: fMoney,
          halo:
            data.cashFlow.value >= 0
              ? "var(--kg-positive-500)"
              : "var(--kg-negative-500)",
        };
      case "ar":
        return {
          title: "Cuentas por cobrar",
          value: fMoney(data.ar.value),
          parts: data.ar.parts,
          fmt: fMoney,
          halo: "var(--kg-warning-500)",
        };
      case "ap":
        return {
          title: "Cuentas por pagar",
          value: fMoney(data.ap.value),
          parts: data.ap.parts,
          fmt: fMoney,
          halo: "var(--kg-negative-500)",
        };
      case "equity":
        return {
          title: "Patrimonio neto",
          value: fMoney(data.equity.value),
          parts: data.equity.parts,
          fmt: fMoney,
          halo:
            data.equity.value >= 0
              ? "var(--kg-positive-500)"
              : "var(--kg-negative-500)",
        };
    }
  }, [open, data]);

  // Runway tone: si el clasificador no dio "ok" (stale-snapshot o no-burn-data)
  // → neutral, no queremos pintar advertencia sobre un dato ausente. Con "ok"
  // los umbrales son los de siempre (≥12 positivo, ≥6 warning, resto negativo).
  const runwayTone: HeroKpiTone =
    data.runway.reason !== "ok" || data.runway.months == null
      ? "neutral"
      : data.runway.months >= 12
        ? "positive"
        : data.runway.months >= 6
          ? "warning"
          : "negative";

  const cfTone: SupportKpiTone = data.cashFlow.value >= 0 ? "positive" : "negative";
  const netTone: HeroKpiTone = data.netProfit.value >= 0 ? "positive" : "negative";
  const marginTone: SupportKpiTone =
    data.margin == null ? "neutral" : data.margin >= 0.15 ? "positive" : data.margin >= 0 ? "warning" : "negative";

  const shownRevenueTrend = data.revenueSeries.buckets.filter((b) => b.revenue > 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* ═════════════════════ ContextBar sticky ═════════════════════ */}
      <ContextBar
        icon={<IconFin size={16} />}
        title="Kingrow · Financiero"
        stats={[
          { l: "Bancos (USD)", v: fmtUsd(data.banks.totalUsd) },
          { l: "Por cobrar", v: fMoneyK(data.ar.value) },
          { l: "Por pagar", v: fMoneyK(data.ap.value) },
          { l: "Facturas pendientes", v: fCount(data.counts.invoicesPending) },
          { l: "Liquidaciones", v: fCount(data.counts.settlementsInPeriod) },
          { l: "Gastos", v: fCount(data.counts.expensesInPeriod) },
        ]}
      />

      {/*
        Selector de período. Desktop-only: en mobile el PeriodPicker vive
        dentro del bottom-sheet (registrado arriba con useRegisterPageFilters)
        para que la topbar mobile no se llene. Ver `src/components/kg/page-menu`.
      */}
      <div
        className="hidden md:flex"
        style={{
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
          Período: <strong style={{ color: "var(--kg-text-1)" }}>{data.period.label}</strong>
        </div>
        <PeriodPicker
          fromYmd={data.period.rangeStart}
          toYmd={data.period.rangeEnd}
        />
      </div>

      {/* ═════════════════════ Fila 1 · HeroKpi × 4 ═════════════════════ */}
      <div style={gridStyle}>
        <div style={span(3)}>
          <HeroKpi
            label="Ingreso de Kingrow"
            value={data.revenue.value}
            format={fMoney}
            sub={`Liquidaciones externas + facturas cobradas propias · ${data.period.label}`}
            tone="positive"
            featured
            spark={shownRevenueTrend.map((b) => b.revenue)}
            delta={data.revenueSeries.delta?.value}
            deltaDir={data.revenueSeries.delta?.dir}
            onOpen={() => setOpen("revenue")}
          />
        </div>
        <div style={span(3)}>
          <HeroKpi
            label="Utilidad neta"
            value={data.netProfit.value}
            format={fMoney}
            sub={
              data.margin != null ? `Margen neto ${fPct(data.margin)}` : "Sin ingresos en el período"
            }
            tone={netTone}
            onOpen={() => setOpen("netProfit")}
          />
        </div>
        <div style={span(3)}>
          {data.banks.bankCount === 0 ? (
            <EmptyKpiCard
              label="Bancos"
              hint="Registrá bancos activos en Financiero → Bancos para ver el saldo consolidado."
            />
          ) : (
            <HeroKpi
              label="Bancos"
              value={data.banks.totalUsd ?? Number.NaN}
              format={fmtUsd}
              sub={banksSubtitle(data.banks)}
              tone="neutral"
              help="Saldo consolidado en USD de todos los bancos activos. Se calcula en runtime: saldo inicial + cobros (por método de pago vinculado al banco) + movimientos manuales (ingresos − egresos). Los bancos en ARS se convierten con la última tasa mensual cargada a nivel organización."
            />
          )}
        </div>
        <div style={span(3)}>
          <HeroKpi
            label="Runway"
            value={data.runway.months ?? 0}
            format={(n) => (data.runway.months == null ? "—" : fMonths(n))}
            sub={runwaySubtitle(data.runway.reason, data.burn)}
            tone={runwayTone}
            help="Runway = Caja consolidada de bancos ÷ Burn mensual. Caja = suma de saldos de todos los bancos activos en USD (ARS convertido con la tasa mensual). Burn = promedio mensual de gastos operativos + costos directos (publicidad + comisiones) + nómina + impuestos de los últimos 3 meses calendario cerrados. El mes en curso se excluye para no subestimar el burn. Muestra '—' cuando no hay gastos en la ventana o falta tasa FX para consolidar bancos, '0 meses' cuando la caja se agotó."
          />
        </div>
      </div>

      {/* ═════════════════════ Fila 2 · P&L (5) + Tendencia (7) ═════════════════════ */}
      <div style={gridStyle}>
        <div style={span(5)}>
          <Panel title="Estado de resultados">
            {data.revenue.value === 0 &&
            data.plParts.every((p) => p.v === 0) ? (
              <EmptyState
                title="Sin actividad económica en el período"
                hint="Alimentado por liquidaciones + facturas + gastos + nómina del rango elegido."
              />
            ) : (
              <Breakdown
                total={data.plNet}
                totalLabel="Utilidad neta"
                parts={data.plParts}
                fmtFn={fMoney}
              />
            )}
          </Panel>
        </div>
        <div style={span(7)}>
          <Panel title="Tendencia de facturación (12 meses)">
            {shownRevenueTrend.length < 2 ? (
              <EmptyState
                title="Sin serie temporal suficiente"
                hint="Cuando se liquiden lanzamientos o se cobren facturas, aparece la tendencia."
              />
            ) : (
              <div style={{ height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.revenueSeries.buckets.slice()}>
                    <defs>
                      <linearGradient id="kgFin" x1="0" y1="0" x2="0" y2="1">
                        <stop
                          offset="0%"
                          stopColor="var(--kg-accent-500)"
                          stopOpacity={0.42}
                        />
                        <stop
                          offset="100%"
                          stopColor="var(--kg-accent-500)"
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--kg-border-subtle)"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 10, fill: "var(--kg-text-3)" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "var(--kg-text-3)" }}
                      width={46}
                      tickFormatter={fMoneyK}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "var(--kg-surface-2-solid)",
                        border: "1px solid var(--kg-border-subtle)",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      labelStyle={{ color: "var(--kg-text-3)" }}
                      itemStyle={{ color: "var(--kg-text-1)" }}
                      formatter={(v: number) => fMoney(v)}
                    />
                    <Area
                      type="monotone"
                      dataKey="revenue"
                      stroke="var(--kg-accent-500)"
                      strokeWidth={2}
                      fill="url(#kgFin)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </Panel>
        </div>
      </div>

      {/* ═════════════════════ Fila 3 · SupportKpi × 6 ═════════════════════ */}
      <div style={gridStyle}>
        <div style={span(2)}>
          <SupportKpi
            label="Flujo de caja"
            value={data.cashFlow.value}
            format={fMoneyK}
            tone={cfTone}
            onOpen={() => setOpen("cashFlow")}
          />
        </div>
        <div style={span(2)}>
          <SupportKpi
            label="Margen neto"
            value={data.margin ?? Number.NaN}
            format={fPct}
            tone={marginTone}
            help="Margen neto = Utilidad neta ÷ Ingresos. Qué porcentaje del ingreso queda como ganancia después de restar todos los costos (gastos operativos + costos directos + nómina + impuestos). Ej: 20% = por cada US$100 que entran, US$20 quedan como utilidad. Bajo 0% significa que estás perdiendo plata en el período. Muestra '—' cuando no hay ingresos (división por cero)."
          />
        </div>
        <div style={span(2)}>
          <SupportKpi
            label="Por cobrar"
            value={data.ar.value}
            format={fMoneyK}
            tone={data.ar.value > 0 ? "warning" : "neutral"}
            onOpen={() => setOpen("ar")}
          />
        </div>
        <div style={span(2)}>
          <SupportKpi
            label="Por pagar"
            value={data.ap.value}
            format={fMoneyK}
            tone={data.ap.value > 0 ? "negative" : "neutral"}
            onOpen={() => setOpen("ap")}
          />
        </div>
        <div style={span(2)}>
          <SupportKpi
            label="Patrimonio neto"
            value={data.equity.value}
            format={fMoneyK}
            tone={data.equity.value >= 0 ? "positive" : "negative"}
            onOpen={() => setOpen("equity")}
          />
        </div>
        <div style={span(2)}>
          {/*
            Burn mensual. Antes se leía en el subtítulo del Runway, pero
            ese sub solo lo muestra cuando `reason === 'ok'`. En los otros
            dos estados (stale-snapshot, no-burn-data) el burn desaparecía
            de la pantalla — justo cuando más importa saber cuánto se está
            gastando. Está siempre visible acá.
            Facturación del grupo (que ocupaba este slot) pasa al StatRow.
            Regla 6b-rev: en las tarjetas, plata de Kingrow; en el StatRow,
            volumen del grupo.
          */}
          <SupportKpi
            label="Burn mensual"
            value={data.burn}
            format={fMoneyK}
            tone={data.burn > 0 ? "warning" : "neutral"}
            help="Promedio mensual de todos los costos que restan a la utilidad neta — gastos operativos + costos directos (publicidad + comisiones al equipo) + nómina + impuestos — sobre los últimos 3 meses calendario cerrados (ventana fija; el mes en curso queda excluido). Alimenta el cálculo del Runway. Si acabás de cargar gastos con fecha del mes en curso, no van a aparecer acá hasta el mes siguiente — usá la fecha del devengo (cuándo se generó el servicio), no la del pago."
          />
        </div>
      </div>

      {/* ═════════════════════ StatRow (nivel 3) ═════════════════════
        Contadores de calidad de dato al final: el sistema no puede
        diferenciar una venta suelta legítima (sin lanzamiento a propósito)
        de un vínculo faltante. Que estén a la vista para que alguien los
        revise — la diferencia es plata contada o no contada.
      */}
      <StatRow
        items={[
          { l: "Gastos del período", v: fMoney(data.stats.expensesTotal) },
          { l: "Nómina del período", v: fMoney(data.stats.payrollTotal) },
          { l: clientBalanceLabel(data.stats.clientBalance), v: fMoney(Math.abs(data.stats.clientBalance)) },
          {
            l: `Facturación del grupo (${fCount(data.groupVolume.count)})`,
            v: fMoney(data.groupVolume.value),
          },
          {
            l: `Cobros de terceros (${fCount(data.stats.thirdPartyReceivableCount)})`,
            v: fMoney(data.stats.thirdPartyReceivable),
          },
          { l: "Facturas pendientes", v: fCount(data.counts.invoicesPending) },
          { l: "Liquidaciones del período", v: fCount(data.counts.settlementsInPeriod) },
          { l: "Facturas sin proyecto", v: fCount(data.counts.invoicesMissingProject) },
          { l: "Facturas sin lanzamiento", v: fCount(data.counts.invoicesMissingLaunch) },
        ]}
      />

      {/* ═════════════════════ Fila 4 · Liquidaciones (7) + Egresos (5) ═════════════════════ */}
      <div style={gridStyle}>
        <div style={span(7)}>
          <Panel title="Liquidaciones por lanzamiento (período)">
            {data.launchSettlements.length === 0 ? (
              <EmptyState
                title="Sin liquidaciones en el período"
                hint="Cuando un lanzamiento cierre, aparece acá con lo cobrado / retenido / transferido."
              />
            ) : (
              <ActivityFeed
                items={data.launchSettlements.map((s) => ({
                  id: `${s.launchName}-${s.status}`,
                  title: s.launchName,
                  detail: `Cobrado ${fMoney(s.collected)} · Retenido ${fMoney(s.retained)} · Cliente ${fMoney(s.owed)}`,
                  tag: statusLabel(s.status),
                  color:
                    s.status === "transferida"
                      ? "#00D084"
                      : s.status === "liquidada"
                        ? "#FFB800"
                        : "#8A8A99",
                }))}
              />
            )}
          </Panel>
        </div>
        <div style={span(5)}>
          <Panel title="Estructura de egresos">
            {data.expenseCategories.length === 0 ? (
              <EmptyState
                title="Sin egresos en el período"
                hint="La estructura se arma agrupando gastos por categoría + nómina."
              />
            ) : (
              <Breakdown
                total={data.expenseCategories.reduce((acc, c) => acc + c.amount, 0)}
                totalLabel="Total egresos"
                parts={data.expenseCategories.map((c) => ({ l: c.label, v: c.amount }))}
                fmtFn={fMoney}
              />
            )}
          </Panel>
        </div>
      </div>

      {/* ═════════════════════ Fila 5 · Balance general ═════════════════════ */}
      <div style={gridStyle}>
        <div style={span(12)}>
          <Panel title="Balance general">
            {data.equity.parts.every((p) => p.v === 0) ? (
              <EmptyState
                title="Sin activos ni pasivos registrados"
                hint="El patrimonio neto se calcula como Σ activos activos − Σ pasivos vigentes − AP corriente."
              />
            ) : (
              <div style={{ display: "grid", gap: 20, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                <Breakdown
                  total={data.equity.value}
                  totalLabel="Patrimonio neto"
                  parts={data.equity.parts}
                  fmtFn={fMoney}
                />
                <SectionHeader
                  icon={<IconFin size={14} />}
                  title="Composición"
                  stats={[
                    { l: "Activos", v: fMoneyK(sumPositive(data.equity.parts)) },
                    { l: "Pasivos", v: fMoneyK(sumNegative(data.equity.parts)) },
                  ]}
                />
              </div>
            )}
          </Panel>
        </div>
      </div>

      {openDetail && (
        <ProvenanceDrawer
          open={open != null}
          onClose={() => setOpen(null)}
          title={openDetail.title}
          value={openDetail.value}
          parts={openDetail.parts}
          fmtFn={openDetail.fmt}
          haloTone={openDetail.halo}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Sub-componentes locales
// ═══════════════════════════════════════════════════════════════════════════

function EmptyKpiCard({ label, hint }: { readonly label: string; readonly hint: string }) {
  return (
    <div
      className="kg-glass"
      style={{
        borderRadius: "var(--kg-r-20)",
        padding: "22px 24px",
        minHeight: 168,
        display: "flex",
        flexDirection: "column",
        boxShadow: "var(--kg-shadow-amb)",
      }}
    >
      <div className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
        {label}
      </div>
      <div
        style={{
          margin: "auto 0",
          textAlign: "center",
          color: "var(--kg-text-3)",
          fontSize: 12,
        }}
      >
        {hint}
      </div>
    </div>
  );
}

function banksSubtitle(banks: BanksSnapshot): string {
  if (banks.needsFxRate) {
    return "Falta cargar tasa ARS/USD para consolidar";
  }
  const count = `${banks.bankCount} banco${banks.bankCount === 1 ? "" : "s"} activo${banks.bankCount === 1 ? "" : "s"}`;
  if (banks.fxMonth) return `${count} · tasa ${banks.fxMonth}`;
  return count;
}

function runwaySubtitle(
  reason: RunwaySnapshot["reason"],
  _burn: number,
): string {
  if (reason === "no-cash-data")
    return "Falta cargar tasa ARS/USD para consolidar la caja";
  if (reason === "stale-snapshot") return "Requiere actualizar el snapshot de caja";
  if (reason === "no-burn-data") return "Sin gastos registrados en los últimos 3 meses";
  // Ventana explícita: el usuario no puede creer que el runway responde al
  // ?range elegido arriba — es 3 meses cerrados, fijo. El burn ya tiene su
  // propia tarjeta (SupportKpi de "Burn mensual"), no lo duplicamos acá.
  return "Caja de bancos ÷ costos mensuales promedio (3 meses cerrados)";
}

function statusLabel(s: "abierta" | "liquidada" | "transferida"): string {
  if (s === "abierta") return "Borrador";
  if (s === "liquidada") return "Liquidada";
  return "Transferida";
}

function clientBalanceLabel(balance: number): string {
  if (balance > 0) return "Debemos a clientes";
  if (balance < 0) return "Clientes nos deben";
  return "Saldo con clientes";
}

function sumPositive(parts: ReadonlyArray<{ readonly v: number }>): number {
  return parts.filter((p) => p.v > 0).reduce((a, b) => a + b.v, 0);
}

function sumNegative(parts: ReadonlyArray<{ readonly v: number }>): number {
  return parts.filter((p) => p.v < 0).reduce((a, b) => a + Math.abs(b.v), 0);
}
