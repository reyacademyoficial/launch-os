"use client";

import type { ReactNode } from "react";

import { EmptyState } from "@/components/kg/empty-state";
import { Panel } from "@/components/kg/panel";
import type {
  BankFeesBreakdown,
  BankFeesByBank,
  FeeOrigin,
} from "@/lib/finance/bank-fees";
import { fPct } from "@/lib/finance/format";
import { fmtUsd } from "@/lib/money";

// ═══════════════════════════════════════════════════════════════════════════
// Panel dedicado de comisiones bancarias — vive en /financiero/bancos.
//
// Muestra:
//   1. KPI hero: total comisiones USD + % del cash flow del período.
//   2. Breakdown por origen (facturas, gastos, nómina, transferencias) con
//      total y % contra el pago principal de cada tipo.
//   3. Breakdown por banco (cuál cobra más comisiones).
//   4. Top 10 comisiones más caras.
//
// Todos los montos vienen ya convertidos a USD por la page. La distinción
// ARS/USD por banco se preserva solo en el breakdown por banco para leer
// el label — el número siempre está en USD.
// ═══════════════════════════════════════════════════════════════════════════

const ORIGIN_LABELS: Record<FeeOrigin, string> = {
  invoice: "Facturas cobradas",
  expense: "Gastos pagados",
  payroll: "Sueldos pagados",
  transfer: "Transferencias a clientes",
};
const ORIGIN_COLORS: Record<FeeOrigin, string> = {
  invoice: "#00D084",
  expense: "#EF4444",
  payroll: "#4078FF",
  transfer: "#FFB800",
};

export function BankFeesPanel({
  data,
  periodLabel,
}: {
  readonly data: BankFeesBreakdown;
  readonly periodLabel: string;
}) {
  if (data.count === 0) {
    return (
      <Panel title={`Comisiones bancarias · ${periodLabel}`}>
        <EmptyState
          title="Sin comisiones bancarias conciliadas en el período"
          hint="Al conciliar una factura, gasto, sueldo o transferencia, elegí el rol 'comisión' para el movimiento que representa el fee del banco. Los totales van apareciendo acá."
        />
      </Panel>
    );
  }

  const hasCashFlow = data.ratioVsCashFlow != null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* ─── KPI hero ─────────────────────────────────────────────────── */}
      <Panel title={`Comisiones bancarias · ${periodLabel}`}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 20,
            alignItems: "center",
          }}
        >
          <HeroStat
            label="Total comisiones (USD)"
            value={fmtUsd(data.totalFees)}
            tone="warning"
          />
          <HeroStat
            label="Movimientos conciliados como comisión"
            value={String(data.count)}
            tone="neutral"
          />
          <HeroStat
            label="% sobre el flujo de caja"
            value={hasCashFlow ? fPct(data.ratioVsCashFlow!) : "—"}
            tone={
              data.ratioVsCashFlow != null && data.ratioVsCashFlow > 0.05
                ? "warning"
                : "positive"
            }
            hint={
              hasCashFlow
                ? "totalComisiones ÷ (entradas + salidas del período)"
                : "Sin cash flow en el período"
            }
          />
        </div>
      </Panel>

      {/* ─── Desglose por origen ──────────────────────────────────────── */}
      <Panel title="Por origen del pago">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {(Object.keys(ORIGIN_LABELS) as FeeOrigin[]).map((origin) => {
            const b = data.byOrigin[origin];
            const pctOfTotal =
              data.totalFees > 0 ? b.fees / data.totalFees : 0;
            return (
              <OriginRow
                key={origin}
                label={ORIGIN_LABELS[origin]}
                color={ORIGIN_COLORS[origin]}
                fees={b.fees}
                count={b.count}
                principalTotal={b.principalTotal}
                ratioVsPrincipal={b.ratioVsPrincipal}
                pctOfTotal={pctOfTotal}
              />
            );
          })}
        </div>
      </Panel>

      {/* ─── Por banco + Top comisiones ───────────────────────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          alignItems: "start",
        }}
      >
        <Panel title="Por banco">
          {data.byBank.length === 0 ? (
            <EmptyState title="Sin comisiones registradas por banco" hint="" />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {data.byBank.map((b) => (
                <BankRow key={b.bankId} bank={b} totalFees={data.totalFees} />
              ))}
            </div>
          )}
        </Panel>
        <Panel title="Top comisiones más caras">
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {data.topFees.map((f) => (
              <div
                key={f.movementId}
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto",
                  gap: 10,
                  alignItems: "center",
                  padding: "6px 10px",
                  borderRadius: "var(--kg-r-8)",
                  background: "var(--kg-surface-2-solid)",
                  border: "1px solid var(--kg-border-subtle)",
                  fontSize: 12,
                }}
                title={`${ORIGIN_LABELS[f.origin]}: ${f.itemLabel}${f.principalAmount != null ? ` (principal ${fmtUsd(f.principalAmount)})` : ""}`}
              >
                <OriginChip origin={f.origin} />
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      color: "var(--kg-text-1)",
                      fontWeight: 600,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {f.itemLabel}
                  </div>
                  <div
                    className="kg-t7"
                    style={{ color: "var(--kg-text-3)" }}
                  >
                    {f.bankName} · {fmtDate(f.occurredAt)}
                    {f.principalAmount != null && f.principalAmount > 0 && (
                      <>
                        {" · "}
                        {((f.amount / f.principalAmount) * 100).toFixed(1)}%
                        del principal
                      </>
                    )}
                  </div>
                </div>
                <div
                  className="kg-num"
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: "#FFB800",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {fmtUsd(f.amount)}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Sub-componentes
// ═══════════════════════════════════════════════════════════════════════════

function HeroStat({
  label,
  value,
  tone,
  hint,
}: {
  readonly label: string;
  readonly value: string;
  readonly tone: "positive" | "warning" | "negative" | "neutral";
  readonly hint?: string;
}) {
  const color =
    tone === "positive"
      ? "#00D084"
      : tone === "warning"
        ? "#FFB800"
        : tone === "negative"
          ? "#EF4444"
          : "var(--kg-text-1)";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "10px 14px",
        borderRadius: "var(--kg-r-8)",
        background: "var(--kg-surface-2-solid)",
        border: "1px solid var(--kg-border-subtle)",
      }}
      title={hint}
    >
      <span className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
        {label}
      </span>
      <strong
        style={{
          fontSize: 22,
          fontWeight: 800,
          color,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </strong>
    </div>
  );
}

function OriginRow({
  label,
  color,
  fees,
  count,
  principalTotal,
  ratioVsPrincipal,
  pctOfTotal,
}: {
  readonly label: string;
  readonly color: string;
  readonly fees: number;
  readonly count: number;
  readonly principalTotal: number;
  readonly ratioVsPrincipal: number | null;
  readonly pctOfTotal: number;
}) {
  const pctBar = Math.min(100, pctOfTotal * 100);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "180px 1fr auto",
        gap: 12,
        alignItems: "center",
        padding: "8px 12px",
        borderRadius: "var(--kg-r-8)",
        background: "var(--kg-surface-2-solid)",
        border: "1px solid var(--kg-border-subtle)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 2,
            background: color,
            display: "inline-block",
          }}
        />
        <span
          style={{
            fontSize: 12,
            color: "var(--kg-text-1)",
            fontWeight: 600,
          }}
        >
          {label}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div
          style={{
            width: "100%",
            height: 6,
            borderRadius: 999,
            background: "var(--kg-surface-2-solid)",
            border: "1px solid var(--kg-border-subtle)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${pctBar}%`,
              height: "100%",
              background: color,
            }}
          />
        </div>
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", fontSize: 10 }}
        >
          {count} movim. · Principal {fmtUsd(principalTotal)}
          {ratioVsPrincipal != null && (
            <>
              {" · "}Comisión / principal:{" "}
              <b style={{ color: "var(--kg-text-2)" }}>
                {fPct(ratioVsPrincipal)}
              </b>
            </>
          )}
        </div>
      </div>
      <div
        style={{
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
          fontSize: 13,
          fontWeight: 700,
          color: "var(--kg-text-1)",
        }}
      >
        {fmtUsd(fees)}
        <div
          className="kg-t7"
          style={{ color: "var(--kg-text-3)", fontSize: 10 }}
        >
          {(pctOfTotal * 100).toFixed(1)}% del total
        </div>
      </div>
    </div>
  );
}

function BankRow({
  bank,
  totalFees,
}: {
  readonly bank: BankFeesByBank;
  readonly totalFees: number;
}) {
  const pct = totalFees > 0 ? bank.fees / totalFees : 0;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto auto",
        gap: 10,
        alignItems: "center",
        padding: "6px 10px",
        borderRadius: "var(--kg-r-8)",
        background: "var(--kg-surface-2-solid)",
        border: "1px solid var(--kg-border-subtle)",
      }}
    >
      <span
        style={{
          fontSize: 12,
          color: "var(--kg-text-1)",
          fontWeight: 600,
        }}
      >
        {bank.bankName}{" "}
        <span
          style={{
            padding: "1px 6px",
            borderRadius: 999,
            background:
              bank.currency === "USD"
                ? "rgba(0,208,132,0.15)"
                : "rgba(138,138,153,0.15)",
            color:
              bank.currency === "USD" ? "#00D084" : "var(--kg-text-3)",
            fontSize: 9,
            fontWeight: 700,
            marginLeft: 4,
          }}
        >
          {bank.currency}
        </span>
      </span>
      <span
        className="kg-t7"
        style={{ color: "var(--kg-text-3)", fontSize: 10 }}
      >
        {bank.count} movim. · {(pct * 100).toFixed(1)}%
      </span>
      <span
        className="kg-num"
        style={{
          fontSize: 13,
          fontWeight: 700,
          color: "#FFB800",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {fmtUsd(bank.fees)}
      </span>
    </div>
  );
}

function OriginChip({ origin }: { readonly origin: FeeOrigin }): ReactNode {
  const label =
    origin === "invoice"
      ? "F"
      : origin === "expense"
        ? "G"
        : origin === "payroll"
          ? "N"
          : "T";
  const color = ORIGIN_COLORS[origin];
  return (
    <span
      title={ORIGIN_LABELS[origin]}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 20,
        height: 20,
        borderRadius: 4,
        background: `${color}22`,
        color,
        fontSize: 10,
        fontWeight: 800,
      }}
    >
      {label}
    </span>
  );
}

function fmtDate(iso: string): string {
  const s = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00Z` : iso;
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
