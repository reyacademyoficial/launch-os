"use client";

import type { ReactNode } from "react";

import { EmptyState } from "./empty-state";
import { KgChartPalette, kgRampColor, KG_RAMP_VARS } from "./line-chart";
import { fCount, fPct } from "@/lib/finance/format";

/**
 * KG · Funnel — embudo por etapas con conversión entre pasos.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * RECHARTS vs SVG/DIVS PROPIOS — DECIDIDO: DIVS PROPIOS
 * ─────────────────────────────────────────────────────────────────────────
 * El consumidor real (`analytics/funnel-chart.tsx`) monta HOY dos cosas: una
 * grilla de 3 cards con el count y "X% del paso anterior", y debajo un
 * `BarChart` de recharts con 3 barras. Leyendo ese archivo se ve que el chart
 * no aporta nada que las cards no digan ya:
 *
 *   · Tres barras no tienen eje X que valga: las categorías son etapas
 *     ordenadas, no una escala.
 *   · El dato que importa —la conversión ENTRE pasos— recharts no lo puede
 *     dibujar. Por eso el consumidor tuvo que ponerlo en cards aparte, y el
 *     lector termina saltando entre dos representaciones del mismo embudo.
 *   · A 390px tres barras verticales con labels largos ("Leads calificados")
 *     se solapan; el eje X se vuelve ilegible.
 *   · Un `ResponsiveContainer` + `BarChart` para tres rectángulos arrastra
 *     todo el runtime de recharts a una vista que puede no tener otro chart.
 *
 * Barras horizontales apiladas verticalmente con el conector de conversión
 * entre medio resuelven las cuatro: el label tiene ancho de sobra, el orden
 * de lectura (arriba → abajo) ES el orden del embudo, la conversión vive
 * donde ocurre, y el componente es HTML puro. Además los valores quedan
 * SIEMPRE visibles como direct labels — que es justo el canal de relieve que
 * pide la guía de dataviz para una rampa cuyo extremo claro queda por debajo
 * de 3:1 contra la superficie.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DECISIONES DE DISEÑO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 1. RAMPA ORDINAL, NO PALETA CATEGÓRICA.
 *    Las etapas de un embudo tienen orden: cambiarlas de lugar cambia el
 *    significado. Eso es una escala ORDINAL, y una escala ordinal se pinta
 *    con un solo hue en pasos de luminosidad, no con ocho hues distintos.
 *    `KG_RAMP_*` (en `line-chart.tsx`) es esa rampa: azul, claro → oscuro,
 *    validada con el validador de la skill en modo `--ordinal` contra las
 *    superficies reales de KG — monotonía L PASS, ΔL adyacente ≥ 0.06 PASS,
 *    extremo claro 2.11:1 vs #ffffff (light) y 3.49:1 vs #111116 (dark) PASS,
 *    hue spread 3° PASS.
 *
 * 2. TOPE DE 5 ETAPAS PARA EL COLOR.
 *    La rampa tiene 5 pasos porque con 6 el ΔL adyacente cae a 0.047 y el
 *    check falla: dos etapas contiguas dejarían de distinguirse. Con más de 5
 *    etapas `kgRampColor` devuelve `null` y todas las barras pasan a un único
 *    hue medio. No es una degradación: con esa cantidad el color ya no puede
 *    llevar el orden, y el orden lo llevan igual la posición vertical, el
 *    ancho decreciente de la barra y los labels. Mejor un color honesto que
 *    seis pasos que el ojo no separa.
 *
 * 3. EL ANCHO ES CONTRA LA PRIMERA ETAPA, NO CONTRA EL MÁXIMO.
 *    Un embudo se lee "de 100% para abajo". Normalizar contra el máximo
 *    escondería una primera etapa que no es el tope (dato sucio); con la
 *    primera como base, una etapa que crece se ve pasando el 100% — que es
 *    exactamente la anomalía que hay que ver.
 *
 * 4. SIN SEMÁFORO.
 *    Ninguna tasa se pinta de verde o rojo. KG define que el color semántico
 *    viaja separado del dato (ver `tone.ts`), y además no existe un umbral
 *    universal de "buena conversión" — depende del embudo. Las tasas van en
 *    tokens de texto. Si un consumidor quiere marcar un estado, tiene
 *    `StateDot` para ponerlo AL LADO.
 *
 * 5. SIN TOOLTIP.
 *    Cada valor y cada tasa ya están en el DOM como texto. Un tooltip que
 *    repite lo que ya se ve es ruido; la guía sólo lo exige donde el valor no
 *    es alcanzable de otra forma.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EJEMPLO DE LLAMADA REAL (forma de datos de `analytics/funnel-chart.tsx`)
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   // stages: FunnelStage[] = [
 *   //   { key: "leads",     label: "Leads",     count: 1840, rateOfPrev: 1 },
 *   //   { key: "agendados", label: "Agendados", count: 412,  rateOfPrev: 0.223 },
 *   //   { key: "vendidos",  label: "Vendidos",  count: 96,   rateOfPrev: 0.233 },
 *   // ]
 *
 *   <Panel title="Embudo de conversión">
 *     <KgFunnel
 *       stages={stages.map((s) => ({
 *         key: s.key,
 *         label: s.label,
 *         count: s.count,
 *       }))}
 *     />
 *   </Panel>
 *
 *   // `rateOfPrev` NO se pasa: el embudo la deriva de los counts. Así el
 *   // porcentaje que se ve y el número que se ve no pueden discrepar.
 */

export interface KgFunnelStage {
  readonly key: string;
  readonly label: string;
  /** Valor de la etapa. `null`/no-finito se trata como hueco, no como 0. */
  readonly count: number | null | undefined;
  /** Aclaración corta bajo el label (de dónde sale el número, caveats). */
  readonly hint?: string;
}

export interface KgFunnelProps {
  readonly stages: readonly KgFunnelStage[];
  /** Formato del valor de cada etapa. Default `fCount`. */
  readonly format?: (n: number | null | undefined) => string;
  /**
   * Muestra "% del total" (contra la primera etapa) junto al valor, además
   * de la conversión contra el paso anterior. Default `true`.
   */
  readonly showShareOfTotal?: boolean;
  readonly footNote?: ReactNode;
  readonly emptyTitle?: string;
  readonly emptyHint?: string;
}

function num(v: number | null | undefined): number | null {
  return v != null && Number.isFinite(v) ? v : null;
}

/** Hue medio de la rampa — fallback cuando el color ya no lleva el orden. */
const RAMP_MID = KG_RAMP_VARS[2] ?? "var(--kg-ramp-3)";

export function KgFunnel({
  stages,
  format = fCount,
  showShareOfTotal = true,
  footNote,
  emptyTitle = "Sin datos en el embudo",
  emptyHint = "Cuando entren leads en el rango elegido, aparecen las etapas y la conversión entre pasos.",
}: KgFunnelProps) {
  const base = num(stages[0]?.count);

  // Un embudo sin primera etapa (o con la primera en cero) no tiene base
  // contra la cual medir nada: no hay embudo que mostrar.
  if (stages.length === 0 || base == null || base <= 0) {
    return <EmptyState title={emptyTitle} hint={emptyHint} />;
  }

  const total = stages.length;

  return (
    <div>
      <KgChartPalette />

      <ol
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {stages.map((stage, i) => {
          const value = num(stage.count);
          const prev = i > 0 ? num(stages[i - 1]?.count) : null;
          // Conversión contra el paso anterior. Sólo existe si ambos lados
          // tienen dato y el anterior no es cero.
          const rateOfPrev =
            i > 0 && value != null && prev != null && prev > 0
              ? value / prev
              : null;
          const share = value != null ? value / base : null;
          const width =
            share == null ? 0 : Math.max(0, Math.min(share, 1)) * 100;
          const overflow = share != null && share > 1;
          const color = kgRampColor(i, total) ?? RAMP_MID;

          return (
            <li key={stage.key} style={{ display: "block" }}>
              {/* Conector: la conversión vive DONDE ocurre, entre dos etapas. */}
              {i > 0 && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 0 6px 2px",
                  }}
                >
                  <span
                    aria-hidden
                    style={{ color: "var(--kg-text-3)", fontSize: 9 }}
                  >
                    ▼
                  </span>
                  <span
                    className="kg-num"
                    style={{
                      color: "var(--kg-text-2)",
                      fontSize: 11,
                      fontWeight: 700,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {rateOfPrev == null ? "—" : fPct(rateOfPrev)}
                  </span>
                  <span
                    style={{ color: "var(--kg-text-3)", fontSize: 11 }}
                  >
                    del paso anterior
                  </span>
                </div>
              )}

              <div>
                {/* Direct labels — siempre visibles, nunca detrás de un hover. */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: 10,
                    marginBottom: 5,
                  }}
                >
                  <span
                    style={{
                      color: "var(--kg-text-2)",
                      fontSize: 12,
                      fontWeight: 600,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {stage.label}
                  </span>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "baseline",
                      gap: 6,
                      flexShrink: 0,
                    }}
                  >
                    <span
                      className="kg-num"
                      style={{
                        color: "var(--kg-text-1)",
                        fontSize: 15,
                        fontWeight: 700,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {format(value)}
                    </span>
                    {showShareOfTotal && i > 0 && share != null && (
                      <span
                        className="kg-num"
                        style={{
                          color: "var(--kg-text-3)",
                          fontSize: 11,
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {fPct(share)}
                      </span>
                    )}
                  </span>
                </div>

                {/* Barra: base a la izquierda (cuadrada), data-end redondeado. */}
                <div
                  style={{
                    height: 12,
                    borderRadius: 4,
                    background: "var(--kg-surface-2)",
                    border: "1px solid var(--kg-border-subtle)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${width}%`,
                      minWidth: value != null && value > 0 ? 3 : 0,
                      background: color,
                      borderRadius: "0 4px 4px 0",
                    }}
                  />
                </div>

                {(stage.hint || overflow) && (
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: 11,
                      lineHeight: 1.4,
                      color: "var(--kg-text-3)",
                    }}
                  >
                    {overflow
                      ? `Esta etapa supera a la primera (${fPct(share ?? 0)}). Revisá la fuente del dato.`
                      : stage.hint}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {footNote != null && (
        <p
          style={{
            margin: "12px 2px 0",
            fontSize: 11,
            lineHeight: 1.45,
            color: "var(--kg-text-3)",
          }}
        >
          {footNote}
        </p>
      )}
    </div>
  );
}
