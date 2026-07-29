"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
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
import { Panel } from "@/components/kg/panel";
import {
  ProvenanceDrawer,
  type ProvenanceSource,
} from "@/components/kg/provenance-drawer";
import { SectionHeader } from "@/components/kg/section-header";
import { StatRow } from "@/components/kg/stat-row";
import { SupportKpi, type SupportKpiTone } from "@/components/kg/support-kpi";
import { fCount, fMoney, fMoneyK, fMonths, fPct } from "@/lib/finance/format";
import { PERIOD_OPTIONS, type PeriodKey } from "@/lib/finance/period";

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
  readonly sources: ReadonlyArray<ProvenanceSource>;
}

export interface RevenueSeries {
  readonly buckets: ReadonlyArray<{ readonly label: string; readonly revenue: number }>;
  /** null = no hay comparable → HeroKpi muestra "sin histórico comparable". */
  readonly delta: { readonly value: string; readonly dir: "up" | "down" } | null;
}

export interface CashSnapshot {
  readonly cashOnHand: number;
  readonly snapshotDate: string | null;
  readonly ageDays: number | null;
  readonly stale: boolean;
  readonly bucketCount: number;
}

export interface RunwaySnapshot {
  /** null = burn ≤ 0 (infinito). undefined si snapshot stale. */
  readonly months: number | null | undefined;
  readonly stale: boolean;
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
  };
  readonly stats: {
    readonly expensesTotal: number;
    readonly payrollTotal: number;
    readonly clientBalance: number;
  };
  readonly revenue: FinancieroKpi;
  readonly revenueSeries: RevenueSeries;
  readonly netProfit: FinancieroKpi;
  readonly cash: CashSnapshot;
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

  const openDetail = useMemo(() => {
    if (!open) return null;
    switch (open) {
      case "revenue":
        return {
          title: "Facturación",
          value: fMoney(data.revenue.value),
          parts: data.revenue.parts,
          sources: data.revenue.sources,
          fmt: fMoney,
          halo: "var(--kg-positive-500)",
        };
      case "netProfit":
        return {
          title: "Utilidad neta",
          value: fMoney(data.netProfit.value),
          parts: data.netProfit.parts,
          sources: data.netProfit.sources,
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
          sources: data.cashFlow.sources,
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
          sources: data.ar.sources,
          fmt: fMoney,
          halo: "var(--kg-warning-500)",
        };
      case "ap":
        return {
          title: "Cuentas por pagar",
          value: fMoney(data.ap.value),
          parts: data.ap.parts,
          sources: data.ap.sources,
          fmt: fMoney,
          halo: "var(--kg-negative-500)",
        };
      case "equity":
        return {
          title: "Patrimonio neto",
          value: fMoney(data.equity.value),
          parts: data.equity.parts,
          sources: data.equity.sources,
          fmt: fMoney,
          halo:
            data.equity.value >= 0
              ? "var(--kg-positive-500)"
              : "var(--kg-negative-500)",
        };
    }
  }, [open, data]);

  const runwayTone: HeroKpiTone =
    data.runway.stale || data.runway.months === undefined
      ? "neutral"
      : data.runway.months === null
        ? "positive"
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
          { l: "Caja", v: fMoneyK(data.cash.cashOnHand) },
          { l: "Por cobrar", v: fMoneyK(data.ar.value) },
          { l: "Por pagar", v: fMoneyK(data.ap.value) },
          { l: "Facturas pendientes", v: fCount(data.counts.invoicesPending) },
          { l: "Liquidaciones", v: fCount(data.counts.settlementsInPeriod) },
          { l: "Gastos", v: fCount(data.counts.expensesInPeriod) },
        ]}
      />

      {/* ═════════════════════ Selector de período ═════════════════════ */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <PeriodPills current={data.period.key} />
      </div>

      {/* ═════════════════════ Fila 1 · HeroKpi × 4 ═════════════════════ */}
      <div style={gridStyle}>
        <div style={span(3)}>
          <HeroKpi
            label="Facturación"
            value={data.revenue.value}
            format={fMoney}
            sub={`Período · ${data.period.label}`}
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
          {data.cash.bucketCount === 0 ? (
            <EmptyKpiCard
              label="Caja"
              hint="Registrá activos tipo caja/banco para ver el saldo."
            />
          ) : (
            <HeroKpi
              label="Caja"
              value={data.cash.cashOnHand}
              format={fMoney}
              sub={cashSubtitle(data.cash)}
              tone="neutral"
            />
          )}
        </div>
        <div style={span(3)}>
          <HeroKpi
            label="Runway"
            value={data.runway.months ?? 0}
            format={(n) => {
              if (data.runway.stale) return "—";
              if (data.runway.months === null) return "∞";
              return fMonths(n);
            }}
            sub={
              data.runway.stale
                ? "Requiere actualizar el snapshot de caja"
                : `Burn ${fMoneyK(data.burn)}/mes`
            }
            tone={runwayTone}
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
          <SupportKpi
            label="Burn mensual"
            value={data.burn}
            format={fMoneyK}
            tone={data.burn > 0 ? "warning" : "neutral"}
          />
        </div>
      </div>

      {/* ═════════════════════ StatRow (nivel 3) ═════════════════════ */}
      <StatRow
        items={[
          { l: "Gastos del período", v: fMoney(data.stats.expensesTotal) },
          { l: "Nómina del período", v: fMoney(data.stats.payrollTotal) },
          { l: clientBalanceLabel(data.stats.clientBalance), v: fMoney(Math.abs(data.stats.clientBalance)) },
          { l: "Facturas pendientes", v: fCount(data.counts.invoicesPending) },
          { l: "Liquidaciones del período", v: fCount(data.counts.settlementsInPeriod) },
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
          sources={openDetail.sources}
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

function PeriodPills({ current }: { readonly current: PeriodKey }) {
  return (
    <div
      style={{
        display: "inline-flex",
        background: "var(--kg-surface-2-solid)",
        border: "1px solid var(--kg-border-subtle)",
        borderRadius: "var(--kg-r-full)",
        padding: 2,
      }}
      role="tablist"
      aria-label="Período"
    >
      {PERIOD_OPTIONS.map((o) => {
        const active = o.key === current;
        return (
          <Link
            key={o.key}
            href={{ pathname: "/financiero", query: { range: o.key } }}
            className="kg-focus"
            role="tab"
            aria-selected={active}
            style={{
              padding: "4px 11px",
              borderRadius: 999,
              background: active ? "var(--kg-accent-500)" : "transparent",
              color: active ? "#fff" : "var(--kg-text-3)",
              fontSize: 11,
              fontWeight: 700,
              textDecoration: "none",
              transition: "all var(--kg-dur) var(--kg-ease)",
            }}
          >
            {o.label}
          </Link>
        );
      })}
    </div>
  );
}

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

function cashSubtitle(cash: CashSnapshot): string {
  if (!cash.snapshotDate) return `${cash.bucketCount} activos de caja/banco`;
  const d = new Date(cash.snapshotDate);
  const formatted = d.toLocaleDateString("es-AR", { day: "numeric", month: "short" });
  return `Snapshot de activos · ${formatted}`;
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
