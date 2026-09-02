"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { EmptyState } from "./empty-state";
import { fCount } from "@/lib/finance/format";

/**
 * KG · LineChart — primitiva de serie temporal multi-serie.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE
 * ─────────────────────────────────────────────────────────────────────────
 * El design system KG solo tenía `Spark` (sparkline sin ejes ni tooltip). Todo
 * chart "de verdad" del repo se escribía a mano, y cada uno inventó su propia
 * paleta y su propio tooltip: `daily/daily-chart.tsx` (7 canales + 3 overlays,
 * leyenda con toggle hecha a mano), `analytics/trends-chart.tsx` (4 series),
 * `consumption/consumption-chart.tsx` (N clases). Tres implementaciones del
 * mismo componente, tres paletas distintas, y todas usando los tokens VIEJOS
 * (--color-border, text-fg-muted) que estamos deprecando.
 *
 * El estándar visual es el `AreaChart` de `financiero/dashboard.tsx`
 * ("Tendencia de facturación"): ejes sin línea ni tick, grid horizontal
 * punteado en --kg-border-subtle, labels de 10px en --kg-text-3, tooltip
 * sobre --kg-surface-2-solid con radio 8. Esta primitiva es esa misma
 * cosa, generalizada a N series.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DECISIONES DE DISEÑO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 1. PALETA CATEGÓRICA EN UN SOLO LUGAR (este archivo).
 *    `KG_SERIES_*` de abajo es la única paleta de identidad de serie del
 *    sistema. `area-chart.tsx` y `funnel.tsx` la importan de acá — no hay
 *    copias. Vive en este archivo (y no en un `chart-palette.ts` propio)
 *    porque el alcance de esta etapa son estos cuatro archivos; si más
 *    adelante aparece un quinto chart, mover el bloque a su propio módulo es
 *    un corte limpio (todo lo exportable ya está marcado `export`).
 *
 * 2. POR QUÉ NO EL CARMESÍ DE MARCA COMO SLOT 1.
 *    En KG `--kg-accent-500` y `--kg-negative-500` son EL MISMO hex (#dc143c).
 *    Usar carmesí como "serie 1" haría que la primera serie de cualquier
 *    chart se leyera como el estado negativo. Los colores de estado están
 *    reservados: nunca hacen de identidad de serie. Por eso los tonos
 *    semánticos (`TONE_VAR` en `tone.ts`) siguen siendo para StateDot/Delta,
 *    y las series usan una paleta categórica aparte. El carmesí sí sigue
 *    mandando en los charts de UNA sola serie que ya existen (el panel de
 *    financiero) — ahí el color no está encodeando identidad.
 *
 * 3. LOS DOS TEMAS, SIN JS.
 *    recharts necesita un color concreto en varios lugares y no hay un token
 *    KG con estos hues. La solución es NO resolver el tema en JS (un
 *    `useEffect` + `setState` está prohibido por el lint del repo, y un
 *    `matchMedia` en render rompe la hidratación): `KgChartPalette` inyecta
 *    un `<style>` — hoisteado y deduplicado por React 19 vía
 *    `href`+`precedence` — que declara `--kg-cat-1..8` con los MISMOS
 *    selectores que usa `globals.css` (`:root` = dark, `@media
 *    prefers-color-scheme: light` sin data-theme, y `html[data-theme=light]`).
 *    Las series entonces se pintan con `var(--kg-cat-N)`, que el navegador
 *    resuelve también dentro de atributos de presentación SVG (`stroke`,
 *    `fill`) — es exactamente lo que ya hace el panel de financiero con
 *    `stroke="var(--kg-accent-500)"`. Resultado: el toggle de tema repinta
 *    el chart sin re-render de React.
 *    `KG_SERIES_HEX` queda exportado como escape hatch para los casos donde
 *    de verdad hace falta un hex literal (export a PNG/canvas, email).
 *
 * 4. PALETA VALIDADA, NO ELEGIDA A OJO.
 *    Los ocho slots salen de la paleta categórica por defecto de la guía de
 *    dataviz, re-validados contra las superficies REALES de KG (light
 *    #ffffff, dark #111116) con el validador de la skill:
 *      · light → banda de luminosidad PASS, croma PASS, separación CVD
 *        PASS (peor par adyacente ΔE 9.1), piso de visión normal PASS
 *        (ΔE 19.6), contraste WARN en los slots 3/4/5 (aqua 2.82:1,
 *        amarillo 2.17:1, magenta 2.69:1 — bajo 3:1).
 *      · dark → los seis checks PASS (peor par CVD ΔE 8.4, contraste todos
 *        ≥ 3:1).
 *    El WARN de contraste en claro NO es descartable: obliga a un canal de
 *    relieve. Acá el relieve es estructural y va siempre: leyenda visible con
 *    el nombre de cada serie en tokens de texto (la identidad nunca es solo
 *    color), punto activo de 8px con anillo de superficie, y tooltip que
 *    lista TODAS las series visibles en cada X. Nunca se pinta texto con el
 *    color de la serie.
 *
 * 5. MÁS DE 8 SERIES → ENCODING COMPUESTO, NUNCA CICLAR HUES.
 *    Ciclar la paleta hace que dos series distintas compartan color; eso es
 *    mentir. `daily-chart` ya tiene el caso: 7 canales + 3 overlays = 10
 *    series. Su solución de facto es la correcta: los overlays son
 *    conceptualmente otro grupo y van punteados. La primitiva la formaliza
 *    con `dashed`: los slots se asignan por índice DENTRO de cada grupo, así
 *    7 sólidas (slots 1-7) + 3 punteadas (slots 1-3) entran sin repetir un
 *    color dentro del mismo grupo. Pasado el slot 8 de un grupo se cae a
 *    gris neutro — señal de que hay que plegar a "Otros" o facetar.
 *
 * 6. LEYENDA PROPIA, NO `<Legend>` DE RECHARTS.
 *    El `<Legend>` de recharts en 390px de ancho se come el alto del chart y
 *    no wrapea bien; además el toggle por click no es accesible por teclado.
 *    La leyenda de acá es HTML fuera del `ResponsiveContainer`: `<button>`
 *    con `aria-pressed`, `kg-focus` del repo, alto mínimo de 26px (hit
 *    target) y `flex-wrap`. Mobile primero.
 *
 * 7. DESVÍO CONSCIENTE DE LA GUÍA DE DATAVIZ.
 *    La guía pide gridlines SÓLIDAS. El precedente del repo usa
 *    `strokeDasharray="3 3"` y la consigna es que estas primitivas se vean
 *    como una generalización de ese panel, no como algo nuevo. Gana la
 *    coherencia del repo: grid punteada. Es el único desvío.
 *
 * 8. UN SOLO EJE Y — Y NO ES UNA OMISIÓN.
 *    `analytics/trends-chart.tsx` hoy dibuja Revenue/Profit/CPL contra un eje
 *    de moneda a la izquierda y Close rate contra un eje de porcentaje a la
 *    derecha. Un chart de doble escala hace que el cruce entre dos líneas
 *    parezca significar algo cuando no significa nada: la posición relativa
 *    la fija quien eligió los dos rangos, no el dato. Esta primitiva NO
 *    expone `yAxisId`. Ese consumidor, al migrar, se parte en dos charts
 *    (uno de moneda, uno de tasa) o indexa todo a una base común.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EJEMPLO DE LLAMADA REAL (forma de datos de `daily/daily-chart.tsx`)
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   // rows: DailyChartRow[] = [{ date: "2026-03-01", meta_ads: 41,
 *   //   organico: 12, whatsapp: 3, sendflow_add: 90, ghl_inbound: 210 }, …]
 *
 *   <Panel title="Leads por día y canal">
 *     <KgLineChart
 *       data={rows}
 *       xKey="date"
 *       height={280}
 *       yLabel="Leads / mensajes"
 *       series={[
 *         { key: "meta_ads",      label: "Meta Ads" },
 *         { key: "organico",      label: "Orgánico" },
 *         { key: "whatsapp",      label: "WhatsApp" },
 *         { key: "sendflow_add",  label: "SendFlow altas",  dashed: true },
 *         { key: "ghl_inbound",   label: "WhatsApp/SMS in", dashed: true },
 *         { key: "ghl_new_leads", label: "Leads GHL",       dashed: true },
 *       ]}
 *       footNote="Las series de comunidad tienen ventanas de atribución
 *                 distintas a las de Meta — los totales NO coinciden."
 *     />
 *   </Panel>
 *
 *   // y el caso `analytics/trends-chart.tsx`, con formato de moneda:
 *   <KgLineChart
 *     data={points} xKey="name"
 *     format={fMoney} yTickFormat={fMoneyK}
 *     series={[
 *       { key: "revenue", label: "Revenue" },
 *       { key: "profit",  label: "Profit"  },
 *       { key: "cpl",     label: "CPL"     },
 *     ]}
 *   />
 */

/* ═══════════════════════════════════════════════════════════════════════
 * PALETA — única fuente de verdad de color de dato del design system KG.
 * ═══════════════════════════════════════════════════════════════════════ */

/** Cantidad de slots categóricos. Pasado esto se pliega a "Otros". */
export const KG_SERIES_MAX = 8;

/**
 * Hexes literales por tema. Solo para consumidores que NO pueden usar
 * `var()` (canvas, export a imagen, email). En el DOM usá `KG_SERIES_VARS`.
 */
export const KG_SERIES_HEX = {
  light: [
    "#2a78d6", // 1 · azul
    "#eb6834", // 2 · naranja
    "#1baf7a", // 3 · aqua
    "#eda100", // 4 · amarillo
    "#e87ba4", // 5 · magenta
    "#008300", // 6 · verde
    "#4a3aa7", // 7 · violeta
    "#e34948", // 8 · rojo
  ],
  dark: [
    "#3987e5",
    "#d95926",
    "#199e70",
    "#c98500",
    "#d55181",
    "#008300",
    "#9085e9",
    "#e66767",
  ],
} as const;

/** Referencias CSS a los slots. Es lo que se le pasa a recharts. */
export const KG_SERIES_VARS: readonly string[] = [
  "var(--kg-cat-1)",
  "var(--kg-cat-2)",
  "var(--kg-cat-3)",
  "var(--kg-cat-4)",
  "var(--kg-cat-5)",
  "var(--kg-cat-6)",
  "var(--kg-cat-7)",
  "var(--kg-cat-8)",
];

/** Color de la serie plegada ("Otros") — gris, igual en ambos temas. */
export const KG_SERIES_OTHER = "var(--kg-neutral-500)";

/**
 * Rampa ORDINAL (un solo hue, claro → oscuro) para etapas ordenadas: embudo,
 * tiers, buckets. NO es categórica: acá el color encoda POSICIÓN, no
 * identidad. 5 pasos es el máximo que valida en tema claro (`--ordinal`:
 * monotonía L PASS, ΔL adyacente ≥ 0.06 PASS, extremo claro 2.11:1 vs
 * #ffffff PASS, hue spread 3° PASS). Con 6 pasos el ΔL cae a 0.047 y falla,
 * por eso el embudo de más de 5 etapas deja de usar la rampa (ver `funnel.tsx`).
 */
export const KG_RAMP_HEX = {
  light: ["#86b6ef", "#5598e7", "#2a78d6", "#1c5cab", "#104281"],
  dark: ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf"],
} as const;

export const KG_RAMP_VARS: readonly string[] = [
  "var(--kg-ramp-1)",
  "var(--kg-ramp-2)",
  "var(--kg-ramp-3)",
  "var(--kg-ramp-4)",
  "var(--kg-ramp-5)",
];

/** Slot categórico N (0-based). Fuera de rango → gris "Otros". */
export function kgSeriesColor(index: number): string {
  return KG_SERIES_VARS[index] ?? KG_SERIES_OTHER;
}

/**
 * Paso N de la rampa ordinal, repartido sobre `total` etapas para que la
 * primera sea siempre la más clara y la última la más oscura sin importar
 * cuántas haya. Con `total > KG_RAMP_VARS.length` devuelve `null`: el color
 * ya no puede llevar el orden y el consumidor debe caer a un solo hue.
 */
export function kgRampColor(index: number, total: number): string | null {
  const steps = KG_RAMP_VARS.length;
  if (total <= 0 || total > steps) return null;
  if (total === 1) return KG_RAMP_VARS[Math.floor((steps - 1) / 2)] ?? null;
  const pos = Math.round((index * (steps - 1)) / (total - 1));
  return KG_RAMP_VARS[pos] ?? null;
}

const PALETTE_CSS = `
:root{
--kg-cat-1:${KG_SERIES_HEX.dark[0]};--kg-cat-2:${KG_SERIES_HEX.dark[1]};
--kg-cat-3:${KG_SERIES_HEX.dark[2]};--kg-cat-4:${KG_SERIES_HEX.dark[3]};
--kg-cat-5:${KG_SERIES_HEX.dark[4]};--kg-cat-6:${KG_SERIES_HEX.dark[5]};
--kg-cat-7:${KG_SERIES_HEX.dark[6]};--kg-cat-8:${KG_SERIES_HEX.dark[7]};
--kg-ramp-1:${KG_RAMP_HEX.dark[0]};--kg-ramp-2:${KG_RAMP_HEX.dark[1]};
--kg-ramp-3:${KG_RAMP_HEX.dark[2]};--kg-ramp-4:${KG_RAMP_HEX.dark[3]};
--kg-ramp-5:${KG_RAMP_HEX.dark[4]};
}
@media (prefers-color-scheme: light){
html:not([data-theme="dark"]):not([data-theme="light"]){
--kg-cat-1:${KG_SERIES_HEX.light[0]};--kg-cat-2:${KG_SERIES_HEX.light[1]};
--kg-cat-3:${KG_SERIES_HEX.light[2]};--kg-cat-4:${KG_SERIES_HEX.light[3]};
--kg-cat-5:${KG_SERIES_HEX.light[4]};--kg-cat-6:${KG_SERIES_HEX.light[5]};
--kg-cat-7:${KG_SERIES_HEX.light[6]};--kg-cat-8:${KG_SERIES_HEX.light[7]};
--kg-ramp-1:${KG_RAMP_HEX.light[0]};--kg-ramp-2:${KG_RAMP_HEX.light[1]};
--kg-ramp-3:${KG_RAMP_HEX.light[2]};--kg-ramp-4:${KG_RAMP_HEX.light[3]};
--kg-ramp-5:${KG_RAMP_HEX.light[4]};
}}
html[data-theme="light"]{
--kg-cat-1:${KG_SERIES_HEX.light[0]};--kg-cat-2:${KG_SERIES_HEX.light[1]};
--kg-cat-3:${KG_SERIES_HEX.light[2]};--kg-cat-4:${KG_SERIES_HEX.light[3]};
--kg-cat-5:${KG_SERIES_HEX.light[4]};--kg-cat-6:${KG_SERIES_HEX.light[5]};
--kg-cat-7:${KG_SERIES_HEX.light[6]};--kg-cat-8:${KG_SERIES_HEX.light[7]};
--kg-ramp-1:${KG_RAMP_HEX.light[0]};--kg-ramp-2:${KG_RAMP_HEX.light[1]};
--kg-ramp-3:${KG_RAMP_HEX.light[2]};--kg-ramp-4:${KG_RAMP_HEX.light[3]};
--kg-ramp-5:${KG_RAMP_HEX.light[4]};
}`;

/**
 * Inyecta las CSS vars de la paleta. React 19 hoistea y deduplica por
 * `href`+`precedence`, así que renderizarlo en cada chart es gratis. Todas
 * las primitivas de este set lo montan solas — el consumidor no lo ve.
 */
export function KgChartPalette() {
  return (
    <style href="kg-chart-palette" precedence="medium">
      {PALETTE_CSS}
    </style>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * CHROME COMPARTIDO — mismos valores que el panel de financiero.
 * ═══════════════════════════════════════════════════════════════════════ */

/** Estilos de eje/grid/tooltip que comparten line-chart y area-chart. */
export const KG_AXIS_TICK = {
  fontSize: 10,
  fill: "var(--kg-text-3)",
} as const;

export const KG_GRID_PROPS = {
  strokeDasharray: "3 3",
  stroke: "var(--kg-border-subtle)",
  vertical: false,
} as const;

/** Anillo de superficie de 2px sobre el punto activo (spec de dataviz). */
export const KG_ACTIVE_DOT = {
  r: 4,
  strokeWidth: 2,
  stroke: "var(--kg-surface-1-solid)",
} as const;

/* ═══════════════════════════════════════════════════════════════════════
 * TIPOS PÚBLICOS
 * ═══════════════════════════════════════════════════════════════════════ */

export interface KgChartSeries {
  /** Clave del campo en cada fila de `data`. También es el id del toggle. */
  readonly key: string;
  /** Nombre visible en leyenda y tooltip. */
  readonly label: string;
  /** Override de color. Por defecto, el slot que le toca en su grupo. */
  readonly color?: string;
  /**
   * Grupo secundario (encoding compuesto). Se dibuja punteada y toma su
   * propio slot 1..8, así 7 sólidas + 3 punteadas no repiten color dentro
   * del mismo grupo. Ver decisión 5.
   */
  readonly dashed?: boolean;
  /** Formato del valor en el tooltip. Cae al `format` del chart. */
  readonly format?: (v: number) => string;
}

/** Fila genérica: el eje X más un número (o hueco) por serie. */
export type KgChartRow = Readonly<Record<string, unknown>>;

export interface KgLineChartProps {
  readonly data: readonly KgChartRow[];
  /** Campo del eje X (fecha, hora, nombre de lanzamiento…). */
  readonly xKey: string;
  readonly series: readonly KgChartSeries[];
  /** Alto del área de plot en px. Default 240 (cómodo en 390px). */
  readonly height?: number;
  /** Formato de valor (tooltip). Default `fCount`. */
  readonly format?: (v: number) => string;
  /** Formato de tick del eje Y. Default: el `format` del chart. */
  readonly yTickFormat?: (v: number) => string;
  /** Formato de tick del eje X. Default: el valor crudo. */
  readonly xTickFormat?: (v: string) => string;
  /**
   * Rótulo del eje Y. Cuesta ~8px de margen izquierdo: ponelo sólo cuando la
   * unidad no se deduce del formato de los ticks.
   */
  readonly yLabel?: string;
  /**
   * Rótulo del eje X. Cuesta ~24px de alto: en un eje de fechas u horas es
   * redundante (los propios ticks lo dicen). Existe por paridad con los
   * consumidores que lo declaran hoy.
   */
  readonly xLabel?: string;
  /** Une los huecos (`null`) en vez de cortar la línea. Default `true`. */
  readonly connectNulls?: boolean;
  readonly allowDecimals?: boolean;
  /** Oculta series sin ningún valor > 0 en todo el rango. Default `true`. */
  readonly hideEmptySeries?: boolean;
  /** Series apagadas al montar (keys). */
  readonly initialHidden?: readonly string[];
  /** Nota al pie (caveats de atribución, sync parcial, etc.). */
  readonly footNote?: ReactNode;
  readonly emptyTitle?: string;
  readonly emptyHint?: string;
}

/* ═══════════════════════════════════════════════════════════════════════
 * HELPERS
 * ═══════════════════════════════════════════════════════════════════════ */

/** Número finito o `null`. Todo lo demás (undefined, "", NaN) es hueco. */
export function kgNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** ¿La serie tiene al menos un valor distinto de 0 en todo el rango? */
function hasSignal(data: readonly KgChartRow[], key: string): boolean {
  return data.some((row) => {
    const n = kgNum(row[key]);
    return n != null && n !== 0;
  });
}

/**
 * Resuelve el color de cada serie: slot por índice DENTRO de su grupo
 * (sólidas por un lado, punteadas por otro). El color sigue a la entidad,
 * no a su posición en el ranking: como el índice se calcula sobre el array
 * `series` declarado y no sobre el filtrado, esconder una serie con el
 * toggle NO repinta a las que quedan.
 */
export function kgResolveSeries(
  series: readonly KgChartSeries[],
): ReadonlyArray<KgChartSeries & { readonly color: string }> {
  let solid = 0;
  let dashed = 0;
  return series.map((s) => {
    const slot = s.dashed ? dashed++ : solid++;
    return { ...s, color: s.color ?? kgSeriesColor(slot) };
  });
}

/** Llave de leyenda/tooltip: un trazo del color de la serie, nunca texto teñido. */
export function KgLineKey({
  color,
  dashed,
}: {
  readonly color: string;
  readonly dashed?: boolean;
}) {
  return (
    <svg width={14} height={8} aria-hidden style={{ flexShrink: 0 }}>
      <line
        x1={0}
        y1={4}
        x2={14}
        y2={4}
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray={dashed ? "4 3" : undefined}
      />
    </svg>
  );
}

/** Swatch rectangular — para áreas y barras (la leyenda espeja la marca). */
export function KgAreaKey({ color }: { readonly color: string }) {
  return (
    <span
      aria-hidden
      style={{
        width: 12,
        height: 8,
        borderRadius: 2,
        background: color,
        flexShrink: 0,
      }}
    />
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * LEYENDA CON TOGGLE
 * ═══════════════════════════════════════════════════════════════════════ */

export function KgChartLegend({
  series,
  hidden,
  onToggle,
  variant = "line",
}: {
  readonly series: ReadonlyArray<KgChartSeries & { readonly color: string }>;
  readonly hidden: ReadonlySet<string>;
  readonly onToggle?: (key: string) => void;
  readonly variant?: "line" | "area";
}) {
  if (series.length < 2) return null;
  const interactive = onToggle != null;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "6px 8px",
        marginBottom: 12,
      }}
    >
      {series.map((s) => {
        const off = hidden.has(s.key);
        const body = (
          <>
            {variant === "area" ? (
              <KgAreaKey color={off ? "var(--kg-neutral-500)" : s.color} />
            ) : (
              <KgLineKey
                color={off ? "var(--kg-neutral-500)" : s.color}
                dashed={s.dashed}
              />
            )}
            <span>{s.label}</span>
          </>
        );
        const style = {
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          minHeight: 26,
          padding: "4px 9px",
          borderRadius: "var(--kg-r-full)",
          border: "1px solid var(--kg-border-subtle)",
          background: off ? "transparent" : "var(--kg-surface-2)",
          color: off ? "var(--kg-text-3)" : "var(--kg-text-2)",
          fontSize: 11,
          fontWeight: 600,
          lineHeight: 1.2,
          cursor: interactive ? "pointer" : "default",
          transition: "color var(--kg-dur) var(--kg-ease)",
        } as const;

        if (!interactive) {
          return (
            <span key={s.key} style={style}>
              {body}
            </span>
          );
        }
        return (
          <button
            key={s.key}
            type="button"
            className="kg-focus"
            aria-pressed={!off}
            title={off ? `Mostrar ${s.label}` : `Ocultar ${s.label}`}
            onClick={() => onToggle(s.key)}
            style={style}
          >
            {body}
          </button>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * TOOLTIP
 * ═══════════════════════════════════════════════════════════════════════ */

interface TooltipEntry {
  readonly dataKey?: string | number;
  readonly value?: unknown;
  readonly color?: string;
}

/**
 * Tooltip compartido. Un solo readout con TODAS las series visibles en esa X
 * — el puntero nunca tiene que aterrizar sobre una línea. El valor manda
 * (kg-num, texto-1) y el nombre de la serie va secundario: en el tooltip el
 * lector ya sabe qué serie es y quiere el número.
 *
 * recharts sigue mandando en el payload las series con `hide`, así que hay
 * que filtrarlas acá (mismo bug que resolvía a mano `daily-chart`).
 */
export function KgChartTooltip({
  active,
  payload,
  label,
  series,
  hidden,
  format,
  variant = "line",
}: {
  readonly active?: boolean;
  readonly payload?: readonly TooltipEntry[];
  readonly label?: unknown;
  readonly series: ReadonlyArray<KgChartSeries & { readonly color: string }>;
  readonly hidden: ReadonlySet<string>;
  readonly format: (v: number) => string;
  readonly variant?: "line" | "area";
}) {
  if (!active || !payload || payload.length === 0) return null;

  const byKey = new Map(series.map((s) => [s.key, s] as const));
  const rows: Array<{
    readonly s: KgChartSeries & { readonly color: string };
    readonly text: string;
  }> = [];
  for (const p of payload) {
    const key = typeof p.dataKey === "string" ? p.dataKey : null;
    if (key == null || hidden.has(key)) continue;
    const s = byKey.get(key);
    if (!s) continue;
    const n = kgNum(p.value);
    if (n == null) continue;
    rows.push({ s, text: (s.format ?? format)(n) });
  }

  if (rows.length === 0) return null;

  return (
    <div
      style={{
        background: "var(--kg-surface-2-solid)",
        border: "1px solid var(--kg-border-subtle)",
        borderRadius: 8,
        boxShadow: "var(--kg-shadow-amb)",
        padding: "8px 10px",
        fontSize: 12,
        minWidth: 132,
      }}
    >
      <div
        style={{ color: "var(--kg-text-3)", marginBottom: 6, fontSize: 11 }}
      >
        {String(label ?? "")}
      </div>
      <div style={{ display: "grid", gap: 4 }}>
        {rows.map(({ s, text }) => (
          <div
            key={s.key}
            style={{ display: "flex", alignItems: "center", gap: 7 }}
          >
            {variant === "area" ? (
              <KgAreaKey color={s.color} />
            ) : (
              <KgLineKey color={s.color} dashed={s.dashed} />
            )}
            <span style={{ color: "var(--kg-text-3)", flex: 1 }}>
              {s.label}
            </span>
            <span
              className="kg-num"
              style={{
                color: "var(--kg-text-1)",
                fontWeight: 700,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Nota al pie compartida por las primitivas de chart. */
export function KgChartFootNote({ children }: { readonly children: ReactNode }) {
  return (
    <p
      style={{
        margin: "10px 2px 0",
        fontSize: 11,
        lineHeight: 1.45,
        color: "var(--kg-text-3)",
      }}
    >
      {children}
    </p>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * COMPONENTE
 * ═══════════════════════════════════════════════════════════════════════ */

export function KgLineChart({
  data,
  xKey,
  series,
  height = 240,
  format = fCount,
  yTickFormat,
  xTickFormat,
  yLabel,
  xLabel,
  connectNulls = true,
  allowDecimals = false,
  hideEmptySeries = true,
  initialHidden,
  footNote,
  emptyTitle = "Sin serie temporal suficiente",
  emptyHint = "Hacen falta al menos dos puntos para dibujar una tendencia.",
}: KgLineChartProps) {
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

  return (
    <div>
      <KgChartPalette />
      <KgChartLegend series={drawn} hidden={hidden} onToggle={toggle} />

      <div style={{ height, width: "100%" }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={rows}
            margin={{
              top: 6,
              right: 10,
              left: yLabel ? 8 : 0,
              bottom: xLabel ? 20 : 0,
            }}
          >
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
                />
              }
            />
            {drawn.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={s.dashed ? "6 3" : undefined}
                dot={rows.length <= 24 ? { r: 2.5, strokeWidth: 0 } : false}
                activeDot={KG_ACTIVE_DOT}
                connectNulls={connectNulls}
                isAnimationActive={false}
                hide={hidden.has(s.key)}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {footNote != null && <KgChartFootNote>{footNote}</KgChartFootNote>}
    </div>
  );
}
