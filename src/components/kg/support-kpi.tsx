"use client";

import { CircleBtn } from "./circle-btn";
import { StateDot } from "./state-dot";
import type { KgTone } from "./tone";

/**
 * KG · SupportKpi. Tarjeta de KPI compacta (nivel 2 de la jerarquía). Sin
 * sparkline, sin sub, sin count-up — solo etiqueta + dot + número 27px.
 *
 * Mismo contrato que HeroKpi respecto al valor calculado:
 * la page pasa `value` crudo + `format`. El registro `KPIS` del artefacto NO
 * cruza al server; toda la fuente de verdad son los selectores de
 * `src/lib/finance/`.
 */
export type SupportKpiTone = KgTone | "neutral";

export interface SupportKpiProps {
  readonly label: string;
  readonly value: number;
  readonly format: (n: number) => string;
  readonly tone?: SupportKpiTone;
  readonly onOpen?: () => void;
}

export function SupportKpi({
  label,
  value,
  format,
  tone = "neutral",
  onOpen,
}: SupportKpiProps) {
  return (
    <div
      className="kg-glass kg-hov"
      style={{
        borderRadius: "var(--kg-r-16)",
        padding: "16px 18px",
        position: "relative",
        boxShadow: "var(--kg-shadow-amb)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 6,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <StateDot tone={tone === "neutral" ? null : tone} size={4} />
          <div className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
            {label}
          </div>
        </div>
        {onOpen && <CircleBtn onClick={onOpen} title={`Ver origen de ${label}`} />}
      </div>
      <div
        className="kg-metric"
        style={{
          fontSize: 27,
          fontWeight: 700,
          letterSpacing: "-.8px",
          lineHeight: 1,
          marginTop: 12,
          color: "var(--kg-text-1)",
        }}
      >
        {format(value)}
      </div>
    </div>
  );
}
