"use client";

import type { ReactNode } from "react";

import { Delta } from "./delta";
import { EmptyState } from "./empty-state";
import { StateDot } from "./state-dot";
import { fCount, fPct } from "@/lib/finance/format";

/**
 * KG · Comparator — grilla TRANSPUESTA de comparación entre entidades.
 *
 * NO es un chart. Es la tabla del comparador dada vuelta.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ TRANSPUESTA
 * ─────────────────────────────────────────────────────────────────────────
 * El consumidor real (`analytics/comparator-table.tsx`) es una tabla wide:
 * una fila por lanzamiento, una columna por KPI, `min-w-[1200px]` y scroll
 * horizontal. Ese layout tiene dos problemas de lectura y uno de crecimiento:
 *
 *   · La pregunta del comparador es "¿cómo va el CPL de A contra el de B?" —
 *     comparar VALORES DE LA MISMA MÉTRICA. En el layout wide esos valores
 *     quedan en la misma columna pero en filas distintas y a 1200px de ancho
 *     compartido; el ojo tiene que saltar verticalmente entre filas mientras
 *     el resto de las columnas mete ruido.
 *   · Al scrollear en horizontal se pierde el nombre del lanzamiento (la
 *     tabla original no tiene columna sticky), así que a mitad de camino no
 *     sabés de quién es el número que estás mirando.
 *   · Los KPIs crecen (hoy son 12 columnas; el brief ya habla de 17
 *     métricas). Cada KPI nuevo ensancha la tabla. Las entidades comparadas,
 *     en cambio, son pocas y acotadas por el filtro.
 *
 * Transpuesta: fila = métrica, columna = entidad. Los valores a comparar
 * quedan uno al lado del otro en la misma fila, la primera columna (el nombre
 * de la métrica) es sticky y sobrevive al scroll horizontal, y agregar
 * métricas hace crecer el alto —que scrollea gratis— en vez del ancho.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DECISIONES DE DISEÑO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 1. `Delta` Y `StateDot` REUSADOS TAL CUAL, SIN REIMPLEMENTAR.
 *    Cada celda que no es la baseline puede llevar su `Delta` contra la
 *    columna baseline.
 *
 * 2. LA FLECHA DEL DELTA ES SEMÁNTICA, EL SIGNO ES ARITMÉTICO.
 *    `Delta` sólo acepta `dir: "up" | "down"` y pinta verde el up y rojo el
 *    down — está cableado a "subir es bueno". Pero en este comparador
 *    conviven métricas donde subir es bueno (Revenue, ROAS) con métricas
 *    donde subir es MALO (CPL). Reimplementar Delta para soportar la
 *    inversión sería duplicar el componente, así que la convención es:
 *
 *      · `dir` = MEJOR (up) / PEOR (down) que la baseline.
 *      · el string del valor lleva el signo aritmético real (+12,4% / -8,1%).
 *
 *    Entonces en un CPL que bajó 8% se ve "▲ -8,1%" en verde: bajó (lo dice
 *    el signo) y eso es mejor (lo dice la flecha y el color). El color nunca
 *    miente sobre si la noticia es buena, y el número nunca miente sobre la
 *    dirección. Cada celda además lleva un `title` que lo dice con palabras.
 *    Con `betterWhen: "none"` (el default) no hay delta: sin dirección
 *    semántica declarada, un color de estado sería inventado.
 *
 * 3. EL NÚMERO NO SE PINTA.
 *    Regla de oro del design system (ver `data-table.tsx` y `tone.ts`): el
 *    valor va siempre en `--kg-text-1`. El estado viaja al lado, en el
 *    `Delta` o en el `StateDot` de "mejor de la fila". El comparador original
 *    pintaba la celda de Profit con `text-success`/`text-error` — eso es
 *    justamente lo que estamos deprecando.
 *
 * 4. BASELINE EXPLÍCITA.
 *    Por defecto la primera entidad. La columna baseline se marca en el
 *    header y no muestra delta contra sí misma.
 *
 * 5. `value` COMO FUNCIÓN, NO COMO MATRIZ.
 *    El consumidor real calcula los KPIs con `calculateLaunchKPIs(l, {...})`
 *    por lanzamiento. Pedirle que arme una matriz lo obligaría a
 *    materializar 17 × N celdas antes de renderizar; con un accessor
 *    `(entityId, metricKey) => number | null` puede memoizar el objeto de
 *    KPIs por launch una sola vez y devolver el campo. `null` es "no
 *    aplica/no hay dato" y se muestra "—", nunca 0.
 *
 * 6. MOBILE.
 *    A 390px entran la columna sticky (150px) más una columna y media de
 *    entidad: se ve de quién es cada valor y se scrollea de a una. El header
 *    de entidad wrapea a dos líneas (label + sub) en vez de truncar a la
 *    nada.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EJEMPLO DE LLAMADA REAL (forma de datos de `analytics/comparator-table.tsx`)
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   // const kpis = new Map(launches.map((l) => [l.id,
 *   //   calculateLaunchKPIs(l, {
 *   //     adsAggregate: adsByLaunch.get(l.id),
 *   //     kanbanSalesAggregate: kanbanSalesByLaunch.get(l.id),
 *   //   })]));
 *
 *   <Panel title="Comparador de lanzamientos" pad={false}>
 *     <KgComparator
 *       entities={launches.map((l) => ({
 *         id: l.id,
 *         label: l.name,
 *         sub: fDateShort(l.date_start),
 *       }))}
 *       metrics={[
 *         { key: "totalInvestment",  label: "Inversión",     format: fMoney, betterWhen: "none"   },
 *         { key: "totalLeads",       label: "Leads",         format: fCount, betterWhen: "higher" },
 *         { key: "cplAvg",           label: "CPL promedio",  format: fMoney, betterWhen: "lower"  },
 *         { key: "showRate",         label: "Show rate",     format: fPct,   betterWhen: "higher" },
 *         { key: "closeRate",        label: "Close rate",    format: fPct,   betterWhen: "higher" },
 *         { key: "ventas",           label: "Ventas",        format: fCount, betterWhen: "higher" },
 *         { key: "revenueEstimated", label: "Revenue est.",  format: fMoney, betterWhen: "higher" },
 *         { key: "revenueCollected", label: "Revenue cobr.", format: fMoney, betterWhen: "higher" },
 *         { key: "roasEstimated",    label: "ROAS est.",     format: fMult,  betterWhen: "higher" },
 *         { key: "roasReal",         label: "ROAS real",     format: fMult,  betterWhen: "higher" },
 *         { key: "profitEstimated",  label: "Profit est.",   format: fMoney, betterWhen: "higher" },
 *       ]}
 *       value={(id, key) => {
 *         const k = kpis.get(id);
 *         if (!k) return null;
 *         if (key === "cplAvg") {
 *           return k.totalLeads > 0 ? k.totalInvestment / k.totalLeads : null;
 *         }
 *         return (k as Record<string, number | undefined>)[key] ?? null;
 *       }}
 *     />
 *   </Panel>
 */

export interface KgComparatorEntity {
  readonly id: string;
  /** Nombre de columna (nombre del lanzamiento, del canal, del mes…). */
  readonly label: string;
  /** Segunda línea del header: fecha, estado, lo que desambigüe. */
  readonly sub?: string;
}

/** Dirección semántica de la métrica: qué lado es "mejor". */
export type KgMetricDirection = "higher" | "lower" | "none";

export interface KgComparatorMetric {
  readonly key: string;
  readonly label: string;
  /** Formateador del valor. Default `fCount`. */
  readonly format?: (v: number | null | undefined) => string;
  /**
   * Qué lado es mejor. Gobierna el color del `Delta` y el `StateDot` de
   * "mejor de la fila". Default `"none"` → sin delta ni highlight.
   */
  readonly betterWhen?: KgMetricDirection;
  /** Aclaración corta bajo el nombre de la métrica. */
  readonly hint?: string;
  /** Separador visual: arranca un bloque de métricas. */
  readonly groupStart?: string;
}

export interface KgComparatorProps {
  readonly entities: readonly KgComparatorEntity[];
  readonly metrics: readonly KgComparatorMetric[];
  /** Accessor de celda. `null`/`undefined` = sin dato (se muestra "—"). */
  readonly value: (
    entityId: string,
    metricKey: string,
  ) => number | null | undefined;
  /** Columna de referencia para los deltas. Default: la primera entidad. */
  readonly baselineId?: string;
  /** Deltas contra la baseline. Default `true` si hay 2+ entidades. */
  readonly showDelta?: boolean;
  /** StateDot en el mejor valor de cada fila con dirección. Default `true`. */
  readonly highlightBest?: boolean;
  /** Ancho de la columna sticky de métricas. Default 150. */
  readonly firstColWidth?: number;
  /** Ancho mínimo de cada columna de entidad. Default 132. */
  readonly colMinWidth?: number;
  readonly footNote?: ReactNode;
  readonly emptyTitle?: string;
  readonly emptyHint?: string;
}

function num(v: number | null | undefined): number | null {
  return v != null && Number.isFinite(v) ? v : null;
}

/** Variación relativa contra la baseline, con signo aritmético explícito. */
function relDelta(value: number, baseline: number): string | null {
  if (baseline === 0) return null;
  const r = (value - baseline) / Math.abs(baseline);
  if (r === 0) return null;
  return `${r > 0 ? "+" : ""}${fPct(r)}`;
}

const CELL_PAD = "9px 14px";

export function KgComparator({
  entities,
  metrics,
  value,
  baselineId,
  showDelta,
  highlightBest = true,
  firstColWidth = 150,
  colMinWidth = 132,
  footNote,
  emptyTitle = "Nada que comparar",
  emptyHint = "Elegí al menos un lanzamiento en los filtros para ver la comparación.",
}: KgComparatorProps) {
  if (entities.length === 0 || metrics.length === 0) {
    return <EmptyState title={emptyTitle} hint={emptyHint} />;
  }

  const baseId = baselineId ?? entities[0]?.id ?? "";
  const withDelta = (showDelta ?? entities.length >= 2) && entities.length >= 2;

  // Fondo SÓLIDO en la columna sticky: con la superficie glass translúcida,
  // las celdas que pasan por debajo al scrollear se transparentarían.
  const stickyCell = {
    position: "sticky",
    left: 0,
    zIndex: 1,
    background: "var(--kg-surface-1-solid)",
  } as const;

  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            minWidth: firstColWidth + entities.length * colMinWidth,
            // `separate` (y no `collapse`) porque con borderCollapse:collapse
            // los bordes de una celda `position: sticky` desaparecen al
            // scrollear en varios navegadores.
            borderCollapse: "separate",
            borderSpacing: 0,
            fontSize: 12.5,
          }}
        >
          <thead>
            <tr>
              <th
                scope="col"
                style={{
                  ...stickyCell,
                  zIndex: 2,
                  width: firstColWidth,
                  minWidth: firstColWidth,
                  textAlign: "left",
                  padding: CELL_PAD,
                  borderBottom: "1px solid var(--kg-border-subtle)",
                  color: "var(--kg-text-3)",
                  fontWeight: 600,
                  fontSize: 11,
                  letterSpacing: 0.2,
                  textTransform: "uppercase",
                }}
              >
                Métrica
              </th>
              {entities.map((e) => (
                <th
                  key={e.id}
                  scope="col"
                  style={{
                    minWidth: colMinWidth,
                    textAlign: "right",
                    padding: CELL_PAD,
                    borderBottom: "1px solid var(--kg-border-subtle)",
                    color: "var(--kg-text-1)",
                    fontWeight: 700,
                    fontSize: 12,
                    verticalAlign: "bottom",
                  }}
                >
                  <div
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {e.label}
                  </div>
                  {(e.sub || (withDelta && e.id === baseId)) && (
                    <div
                      style={{
                        marginTop: 2,
                        color: "var(--kg-text-3)",
                        fontWeight: 500,
                        fontSize: 10,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {withDelta && e.id === baseId
                        ? e.sub
                          ? `${e.sub} · referencia`
                          : "referencia"
                        : e.sub}
                    </div>
                  )}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {metrics.map((m) => {
              const fmt = m.format ?? fCount;
              const dir: KgMetricDirection = m.betterWhen ?? "none";
              const baseValue = num(value(baseId, m.key));

              // Mejor valor de la fila — sólo si la métrica declara dirección.
              let bestId: string | null = null;
              if (highlightBest && dir !== "none" && entities.length >= 2) {
                let bestVal: number | null = null;
                for (const e of entities) {
                  const v = num(value(e.id, m.key));
                  if (v == null) continue;
                  if (
                    bestVal == null ||
                    (dir === "higher" ? v > bestVal : v < bestVal)
                  ) {
                    bestVal = v;
                    bestId = e.id;
                  }
                }
              }

              return (
                <tr key={m.key} className="kg-row">
                  <th
                    scope="row"
                    style={{
                      ...stickyCell,
                      width: firstColWidth,
                      minWidth: firstColWidth,
                      textAlign: "left",
                      padding: CELL_PAD,
                      borderBottom: "1px solid var(--kg-border-subtle)",
                      color: "var(--kg-text-2)",
                      fontWeight: 600,
                      fontSize: 12,
                      verticalAlign: "top",
                    }}
                  >
                    {m.groupStart && (
                      <div
                        className="kg-t7"
                        style={{
                          color: "var(--kg-text-3)",
                          marginBottom: 6,
                        }}
                      >
                        {m.groupStart}
                      </div>
                    )}
                    <div>{m.label}</div>
                    {m.hint && (
                      <div
                        style={{
                          marginTop: 2,
                          fontSize: 10,
                          fontWeight: 500,
                          lineHeight: 1.35,
                          color: "var(--kg-text-3)",
                        }}
                      >
                        {m.hint}
                      </div>
                    )}
                  </th>

                  {entities.map((e) => {
                    const v = num(value(e.id, m.key));
                    const isBase = e.id === baseId;

                    // Delta sólo si: hay más de una entidad, la métrica
                    // declara dirección, no es la propia baseline, y ambos
                    // lados tienen dato.
                    let deltaNode: ReactNode = null;
                    if (
                      withDelta &&
                      dir !== "none" &&
                      !isBase &&
                      v != null &&
                      baseValue != null
                    ) {
                      const text = relDelta(v, baseValue);
                      if (text != null) {
                        const better =
                          dir === "higher" ? v > baseValue : v < baseValue;
                        deltaNode = (
                          <Delta value={text} dir={better ? "up" : "down"} />
                        );
                      }
                    }

                    const deltaTitle =
                      deltaNode != null
                        ? dir === "higher"
                          ? "Flecha = mejor/peor que la referencia. Acá, más es mejor."
                          : "Flecha = mejor/peor que la referencia. Acá, menos es mejor."
                        : undefined;

                    return (
                      <td
                        key={e.id}
                        className="kg-num"
                        title={deltaTitle}
                        style={{
                          minWidth: colMinWidth,
                          textAlign: "right",
                          padding: CELL_PAD,
                          borderBottom: "1px solid var(--kg-border-subtle)",
                          color: "var(--kg-text-1)",
                          fontVariantNumeric: "tabular-nums",
                          whiteSpace: "nowrap",
                          verticalAlign: "top",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "flex-end",
                            gap: 6,
                          }}
                        >
                          {bestId === e.id && (
                            <span title="Mejor valor de la fila">
                              <StateDot tone="positive" />
                            </span>
                          )}
                          <span>{fmt(v)}</span>
                        </div>
                        {deltaNode && (
                          <div style={{ marginTop: 2 }}>{deltaNode}</div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {footNote != null && (
        <p
          style={{
            margin: 0,
            padding: "10px 14px 0",
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
