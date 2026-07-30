"use client";

import { useEffect, useRef, useState } from "react";

import { CircleBtn } from "./circle-btn";
import { Delta } from "./delta";
import { Halo } from "./halo";
import { KgInfoTooltip } from "./info-tooltip";
import { Spark } from "./spark";
import { StateDot } from "./state-dot";
import type { KgTone } from "./tone";

/**
 * KG · HeroKpi. Tarjeta de KPI grande (nivel 1 de la jerarquía).
 *
 * A diferencia del artefacto — que leía del registro `KPIS` / `kpi(id, store)` —
 * este componente recibe el **valor ya calculado** desde la page/dashboard. La
 * page hace el fetch con RLS, corre los selectores puros de `src/lib/finance/`
 * y le pasa el número + formateador.
 *
 * Reglas del design system:
 *   - El número (44px, w700, letter-spacing −1.8px) NUNCA se pinta con el tono
 *     semántico. El tono viaja separado por StateDot (arriba) y Delta (abajo).
 *   - `featured` agrega borde carmesí sutil (`--kg-border-accent`) y sube el
 *     halo al 7%. Reservado para el KPI principal del bento.
 *   - `spark`/`delta` son OPCIONALES. Cuando no hay comparable, va el texto
 *     tenue `sin histórico comparable` — el hueco no se rellena con nada.
 *
 * `onOpen` es opcional. Cuando el KPI no tiene desglose (ej. caja, runway,
 * burn), se omite — nada de botón que abra un drawer vacío.
 */
const HALO_BY_TONE: Record<KgTone | "neutral", string> = {
  positive: "var(--kg-positive-500)",
  negative: "var(--kg-negative-500)",
  warning: "var(--kg-warning-500)",
  accent: "var(--kg-accent-500)",
  neutral: "var(--kg-neutral-500)",
};

export type HeroKpiTone = KgTone | "neutral";

export interface HeroKpiProps {
  readonly label: string;
  /** Valor crudo — se usa para animar el count-up. */
  readonly value: number;
  /** Formateador (fMoney, fMoneyK, fPct, fMonths, …). */
  readonly format: (n: number) => string;
  /** Texto tenue arriba del número (fecha snapshot, contexto). */
  readonly sub?: string;
  /** Tono semántico. `neutral` = sin StateDot pintado. */
  readonly tone?: HeroKpiTone;
  /** Sparkline: solo lo pasa quien tiene serie temporal real (Facturación). */
  readonly spark?: ReadonlyArray<number>;
  /** Texto del delta (ya formateado en %). */
  readonly delta?: string;
  /** Dirección del delta — pintada por `Delta`. */
  readonly deltaDir?: "up" | "down";
  /** Si se pasa, aparece el CircleBtn ↗ que abre el drawer de procedencia. */
  readonly onOpen?: () => void;
  /** Un solo KPI del bento debería llevar `featured`. */
  readonly featured?: boolean;
  /**
   * Explicación del KPI que aparece como tooltip ⓘ al lado del label. Va
   * para KPIs derivados (Runway, Burn, Ingreso) donde el humano necesita
   * saber cómo se calcula. Los directos (Caja, Facturación) suelen no
   * necesitar tooltip.
   */
  readonly help?: string;
}

/**
 * Count-up de 480ms con easing cuadrático. Anima solo cuando cambia el target;
 * si `value` no es finito, se muestra "—" tal cual (a través del formateador).
 * Cheap — nada de librería externa.
 */
function useCountUp(target: number, ms: number = 480): number {
  const [display, setDisplay] = useState<number>(target);
  const raf = useRef<number | null>(null);
  const start = useRef<number>(0);
  const from = useRef<number>(target);

  useEffect(() => {
    if (!Number.isFinite(target)) {
      setDisplay(target);
      return;
    }
    from.current = display;
    start.current = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - start.current) / ms);
      const eased = 1 - (1 - p) * (1 - p);
      setDisplay(from.current + (target - from.current) * eased);
      if (p < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current != null) cancelAnimationFrame(raf.current);
    };
    // Intencional: no incluir `display` en deps — hace loops. Animamos SOLO
    // cuando cambia el target.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, ms]);

  return display;
}

export function HeroKpi({
  label,
  value,
  format,
  sub,
  tone = "neutral",
  spark,
  delta,
  deltaDir,
  onOpen,
  featured,
  help,
}: HeroKpiProps) {
  const shown = useCountUp(value);
  const haloColor = HALO_BY_TONE[tone];

  return (
    <div
      className="kg-glass kg-in"
      style={{
        borderRadius: "var(--kg-r-20)",
        padding: "22px 24px",
        position: "relative",
        overflow: "hidden",
        border: featured ? "1px solid var(--kg-border-accent)" : undefined,
        boxShadow: "var(--kg-shadow-amb)",
        minHeight: 168,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Halo tone={haloColor} op={featured ? 0.07 : 0.05} />

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 8,
          position: "relative",
        }}
      >
        <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 7 }}>
          <StateDot tone={tone === "neutral" ? null : tone} />
          <div className="kg-t7" style={{ color: "var(--kg-text-3)" }}>
            {label}
          </div>
          {help && <KgInfoTooltip content={help} />}
        </div>
        {onOpen && <CircleBtn onClick={onOpen} title={`Ver origen de ${label}`} />}
      </div>

      {sub && (
        <div
          className="kg-t6"
          style={{ color: "var(--kg-text-3)", opacity: 0.7, marginTop: 5 }}
        >
          {sub}
        </div>
      )}

      <div style={{ marginTop: "auto", position: "relative", paddingTop: 18 }}>
        <div
          className="kg-metric"
          style={{
            fontSize: 44,
            fontWeight: 700,
            letterSpacing: "-1.8px",
            lineHeight: 1,
            color: "var(--kg-text-1)",
          }}
        >
          {format(shown)}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            marginTop: 12,
            minHeight: 22,
          }}
        >
          {delta != null && deltaDir != null ? (
            <Delta value={delta} dir={deltaDir} />
          ) : (
            <span
              className="kg-t6"
              style={{ color: "var(--kg-text-3)", opacity: 0.4, fontSize: 10.5 }}
            >
              sin histórico comparable
            </span>
          )}
          {spark && spark.length > 1 && (
            <Spark data={spark} color="var(--kg-neutral-500)" w={92} h={24} />
          )}
        </div>
      </div>
    </div>
  );
}
