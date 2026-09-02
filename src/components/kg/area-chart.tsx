"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { EmptyState } from "./empty-state";
import {
  KG_ACTIVE_DOT,
  KG_AXIS_TICK,
  KG_GRID_PROPS,
  KgChartFootNote,
  KgChartLegend,
  KgChartPalette,
  KgChartTooltip,
  kgNum,
  kgResolveSeries,
  type KgChartRow,
  type KgChartSeries,
} from "./line-chart";
import { fCount } from "@/lib/finance/format";

/**
 * KG · AreaChart — área simple y apilada.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE
 * ─────────────────────────────────────────────────────────────────────────
 * El `AreaChart` del panel "Tendencia de facturación" de
 * `financiero/dashboard.tsx` es el estándar visual del repo, pero está
 * inlineado en la página: una sola serie, gradiente con id literal `"kgFin"`,
 * ejes copiados a mano. Esta primitiva es ese mismo panel generalizado a N
 * series, con el modo apilado que le falta.
 *
 * El consumidor real que se leyó para derivar la API es
 * `launches/consumption/consumption-chart.tsx`: X = hora, una serie por clase
 * configurada, filas construidas como `{ hour, [nombreDeClase]: asistentes }`.
 * Ese chart hoy usa líneas, pero es exactamente el caso de área: magnitud
 * acumulable a lo largo de una ventana horaria, y con `stacked` responde la
 * pregunta que las líneas no responden (cuánta gente hay EN TOTAL a esa hora).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DECISIONES DE DISEÑO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 1. NADA DE COLOR PROPIO.
 *    Importa la paleta, la leyenda, el tooltip y el chrome de ejes de
 *    `line-chart.tsx`. La paleta categórica vive en UN solo lugar (ver la
 *    cabecera de ese archivo para la validación contra las superficies KG y
 *    para por qué el carmesí de marca no es el slot 1).
 *
 * 2. GRADIENTE CON ID ÚNICO POR INSTANCIA.
 *    El precedente hardcodea `<linearGradient id="kgFin">`. Dos charts en la
 *    misma página compartirían ese id y el segundo pisaría al primero (los
 *    ids de SVG son globales al documento). Acá el prefijo sale de `useId()`
 *    y se concatena con la key de la serie.
 *
 * 3. SIMPLE vs APILADO — RELLENOS DISTINTOS, A PROPÓSITO.
 *    · Simple: gradiente del color de la serie 0.42 → 0 (los mismos stops que
 *      el panel de financiero) + trazo de 2px. Es un lavado, no un bloque.
 *    · Apilado: relleno plano al 0.75. Un lavado del 10% no se lee cuando las
 *      bandas se tocan. La guía de dataviz pide 2px de superficie entre
 *      rellenos que se tocan; recharts no expone ese gap, así que el
 *      separador es el trazo de 2px del color de la serie sobre el borde
 *      superior de cada banda — misma función (separar), sin ink extra.
 *
 * 4. HUECOS.
 *    Un área apilada con `connectNulls` miente: rellena un tramo sin dato.
 *    Por eso el default de `connectNulls` es `true` en simple y `false` en
 *    apilado (se puede forzar). En apilado además los `null` se tratan como
 *    hueco real, no como 0.
 *
 * 5. LEYENDA CON TOGGLE, IGUAL QUE LA LÍNEA.
 *    En apilado esconder una serie recalcula el stack — es la lectura
 *    correcta ("¿cuánto queda sin esta clase?"). El color sigue a la entidad:
 *    el slot se asigna sobre el array `series` declarado, así apagar una NO
 *    repinta a las demás.
 *
 * 6. La leyenda y el tooltip usan swatch rectangular (`variant="area"`)
 *    porque la leyenda espeja la marca: rect para áreas, trazo para líneas.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EJEMPLO DE LLAMADA REAL (forma de datos de `consumption/consumption-chart.tsx`)
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   // hourSlots: ["19:00","19:15","19:30",…]
 *   // config.classes: ["Clase 1","Clase 2","Clase 3"]
 *   // const data = hourSlots.map((hour) => {
 *   //   const point: Record<string, string | number> = { hour };
 *   //   for (const c of config.classes) point[c] = readCell(cells, hour, c);
 *   //   return point;
 *   // });
 *
 *   <Panel title="Consumo por clase">
 *     <KgAreaChart
 *       data={data}
 *       xKey="hour"
 *       stacked
 *       height={280}
 *       yLabel="Asistentes"
 *       series={config.classes.map((c) => ({ key: c, label: c }))}
 *     />
 *   </Panel>
 *
 *   // y el caso de una sola serie (el panel de financiero, sin leyenda):
 *   <KgAreaChart
 *     data={data.revenueSeries.buckets}
 *     xKey="label"
 *     height={220}
 *     format={fMoney}
 *     yTickFormat={fMoneyK}
 *     series={[{ key: "revenue", label: "Facturación" }]}
 *   />
 */

export interface KgAreaChartProps {
  readonly data: readonly KgChartRow[];
  readonly xKey: string;
  readonly series: readonly KgChartSeries[];
  /** Apila las series en vez de superponerlas. Default `false`. */
  readonly stacked?: boolean;
  /** Alto del área de plot en px. Default 240. */
  readonly height?: number;
  /** Formato de valor (tooltip). Default `fCount`. */
  readonly format?: (v: number) => string;
  /** Formato de tick del eje Y. Default: el `format` del chart. */
  readonly yTickFormat?: (v: number) => string;
  readonly xTickFormat?: (v: string) => string;
  readonly yLabel?: string;
  readonly xLabel?: string;
  /** Default: `true` en simple, `false` en apilado (ver decisión 4). */
  readonly connectNulls?: boolean;
  readonly allowDecimals?: boolean;
  /** Oculta series sin ningún valor > 0 en todo el rango. Default `true`. */
  readonly hideEmptySeries?: boolean;
  readonly initialHidden?: readonly string[];
  readonly footNote?: ReactNode;
  readonly emptyTitle?: string;
  readonly emptyHint?: string;
}

function hasSignal(data: readonly KgChartRow[], key: string): boolean {
  return data.some((row) => {
    const n = kgNum(row[key]);
    return n != null && n !== 0;
  });
}

export function KgAreaChart({
  data,
  xKey,
  series,
  stacked = false,
  height = 240,
  format = fCount,
  yTickFormat,
  xTickFormat,
  yLabel,
  xLabel,
  connectNulls,
  allowDecimals = false,
  hideEmptySeries = true,
  initialHidden,
  footNote,
  emptyTitle = "Sin serie temporal suficiente",
  emptyHint = "Hacen falta al menos dos puntos para dibujar el área.",
}: KgAreaChartProps) {
  // Prefijo de ids de gradiente, único por instancia montada (decisión 2).
  const gradPrefix = useId().replace(/:/g, "");

  const [hidden, setHidden] = useState<ReadonlySet<string>>(
    () => new Set(initialHidden ?? []),
  );

  const drawn = useMemo(() => {
    const resolved = kgResolveSeries(series);
    return hideEmptySeries
      ? resolved.filter((s) => hasSignal(data, s.key))
      : resolved;
  }, [series, data, hideEmptySeries]);

  const rows = useMemo(() => data.slice(), [data]);

  const toggle = (key: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (rows.length < 2 || drawn.length === 0) {
    return <EmptyState title={emptyTitle} hint={emptyHint} />;
  }

  const yFmt = yTickFormat ?? format;
  const joinNulls = connectNulls ?? !stacked;

  return (
    <div>
      <KgChartPalette />
      <KgChartLegend
        series={drawn}
        hidden={hidden}
        onToggle={toggle}
        variant="area"
      />

      <div style={{ height, width: "100%" }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={rows}
            margin={{
              top: 6,
              right: 10,
              left: yLabel ? 8 : 0,
              bottom: xLabel ? 20 : 0,
            }}
          >
            {!stacked && (
              <defs>
                {drawn.map((s) => (
                  <linearGradient
                    key={s.key}
                    id={`${gradPrefix}-${s.key}`}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor={s.color} stopOpacity={0.42} />
                    <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
            )}
            <CartesianGrid {...KG_GRID_PROPS} />
            <XAxis
              dataKey={xKey}
              tick={KG_AXIS_TICK}
              axisLine={false}
              tickLine={false}
              tickMargin={8}
              minTickGap={22}
              interval="preserveStartEnd"
              tickFormatter={
                xTickFormat ? (v: unknown) => xTickFormat(String(v)) : undefined
              }
              label={
                xLabel
                  ? {
                      value: xLabel,
                      position: "insideBottom",
                      offset: -14,
                      fill: "var(--kg-text-3)",
                      fontSize: 10,
                    }
                  : undefined
              }
            />
            <YAxis
              tick={KG_AXIS_TICK}
              axisLine={false}
              tickLine={false}
              width={48}
              allowDecimals={allowDecimals}
              tickFormatter={(v: number) => yFmt(v)}
              label={
                yLabel
                  ? {
                      value: yLabel,
                      angle: -90,
                      position: "insideLeft",
                      offset: 12,
                      fill: "var(--kg-text-3)",
                      fontSize: 10,
                      style: { textAnchor: "middle" },
                    }
                  : undefined
              }
            />
            <Tooltip
              cursor={{ stroke: "var(--kg-border-strong)", strokeWidth: 1 }}
              content={
                <KgChartTooltip
                  series={drawn}
                  hidden={hidden}
                  format={format}
                  variant="area"
                />
              }
            />
            {drawn.map((s) => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stackId={stacked ? "kg" : undefined}
                stroke={s.color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill={stacked ? s.color : `url(#${gradPrefix}-${s.key})`}
                fillOpacity={stacked ? 0.75 : 1}
                activeDot={KG_ACTIVE_DOT}
                dot={false}
                connectNulls={joinNulls}
                isAnimationActive={false}
                hide={hidden.has(s.key)}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {footNote != null && <KgChartFootNote>{footNote}</KgChartFootNote>}
    </div>
  );
}
