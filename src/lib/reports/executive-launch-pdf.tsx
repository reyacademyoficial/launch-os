import "server-only";

import {
  Document,
  Page,
  Path,
  Rect,
  StyleSheet,
  Svg,
  Text,
  View,
  pdf,
} from "@react-pdf/renderer";

import { fmtDate, fmtLaunchWindow } from "@/lib/format";
import type { LaunchCalendar } from "@/lib/launches/calendar";
import type { LaunchKPIs } from "@/lib/kpis";
import type { MergedDailyRow } from "@/lib/launch-daily/merge";

/**
 * Resumen ejecutivo del lanzamiento en PDF. Pensado para mandar al cliente,
 * no para uso interno — el contenido sale del proyecto + launch + datos
 * diarios mergeados (manual ∪ API).
 *
 * Stack: `@react-pdf/renderer` (JSX server-side, sin browser headless).
 * Fonts: Helvetica built-in. Cargar Inter desde CDN funciona pero introduce
 * latencia y un punto de falla en serverless — Helvetica es predecible.
 *
 * Brand colors: magenta del prototipo (#FF006E) + paleta auxiliar. Hardcoded
 * acá porque los CSS tokens de Tailwind no aplican fuera del DOM.
 *
 * Estructura (1-2 páginas según volumen):
 *   1. Header: proyecto + launch + período + status
 *   2. KPI grid 4x2
 *   3. Timeline del calendario (5 etapas)
 *   4. Bar chart de inversión diaria (SVG inline, no recharts)
 *   5. Breakdown por canal (Meta / Google / TikTok)
 *   6. Footer: "Generado por Launch OS · YYYY-MM-DD"
 */

// ─── Paleta ────────────────────────────────────────────────────────────────

const COLORS = {
  brand: "#FF006E",
  success: "#00D084",
  error: "#FF5A5F",
  warning: "#FFB800",
  fg: "#0F0F12",
  fgMuted: "#52525B",
  fgSubtle: "#A1A1AA",
  border: "#E4E4E7",
  surface: "#FAFAFA",
  meta: "#4285F4",
  google: "#34A853",
  tiktok: "#FF0050",
} as const;

const styles = StyleSheet.create({
  page: {
    flexDirection: "column",
    backgroundColor: "#FFFFFF",
    padding: 32,
    fontFamily: "Helvetica",
    fontSize: 9,
    color: COLORS.fg,
  },
  brandBar: {
    height: 4,
    backgroundColor: COLORS.brand,
    marginBottom: 16,
  },
  header: {
    marginBottom: 18,
  },
  eyebrow: {
    fontSize: 8,
    color: COLORS.fgSubtle,
    textTransform: "uppercase",
    letterSpacing: 1.5,
  },
  title: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    marginTop: 4,
    marginBottom: 6,
  },
  metaLine: {
    fontSize: 9,
    color: COLORS.fgMuted,
  },
  sectionTitle: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    marginBottom: 8,
    marginTop: 14,
    color: COLORS.fg,
  },
  kpiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  kpiCard: {
    width: "24%",
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 4,
    padding: 8,
  },
  kpiLabel: {
    fontSize: 7,
    color: COLORS.fgMuted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  kpiValue: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
  },
  kpiSub: {
    fontSize: 7,
    color: COLORS.fgSubtle,
    marginTop: 2,
  },
  timelineRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  timelineStage: {
    width: 80,
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: COLORS.fgMuted,
  },
  timelineRange: {
    flex: 1,
    fontSize: 9,
  },
  channelRow: {
    flexDirection: "row",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  channelDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
    marginTop: 3,
  },
  channelName: {
    width: 70,
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
  },
  channelMetric: {
    flex: 1,
    fontSize: 9,
  },
  footer: {
    position: "absolute",
    bottom: 16,
    left: 32,
    right: 32,
    fontSize: 7,
    color: COLORS.fgSubtle,
    textAlign: "center",
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 6,
  },
});

// ─── Inputs ────────────────────────────────────────────────────────────────

export interface ExecutiveLaunchInput {
  projectName: string;
  projectBusinessName: string | null;
  launchName: string;
  launchType: string | null;
  launchStatus: string | null;
  platforms: ReadonlyArray<string>;
  dateStart: string | null;
  dateEnd: string | null;
  closedAt: string | null;
  calendar: LaunchCalendar | null;
  kpi: LaunchKPIs;
  mergedDaily: ReadonlyArray<MergedDailyRow>;
}

// ─── Document ──────────────────────────────────────────────────────────────

export function ExecutiveLaunchDocument({ data }: { data: ExecutiveLaunchInput }) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <Document title={`Resumen ejecutivo — ${data.launchName}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.brandBar} />

        <Header data={data} />

        <Text style={styles.sectionTitle}>KPIs principales</Text>
        <KpiGrid kpi={data.kpi} />

        {data.calendar && (
          <>
            <Text style={styles.sectionTitle}>Calendario</Text>
            <Timeline calendar={data.calendar} />
          </>
        )}

        {data.mergedDaily.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Inversión diaria</Text>
            <DailySpendChart rows={data.mergedDaily} />
          </>
        )}

        <Text style={styles.sectionTitle}>Performance por canal</Text>
        <ChannelBreakdown kpi={data.kpi} />

        <Text style={styles.footer} fixed>
          Generado por Launch OS · {today}
        </Text>
      </Page>
    </Document>
  );
}

// ─── Subcomponentes ────────────────────────────────────────────────────────

function Header({ data }: { data: ExecutiveLaunchInput }) {
  const meta: string[] = [];
  meta.push(fmtLaunchWindow(data.dateStart, data.dateEnd));
  if (data.launchType) meta.push(data.launchType);
  if (data.launchStatus) meta.push(data.launchStatus);
  if (data.closedAt) meta.push(`Cerrado ${fmtDate(data.closedAt)}`);

  return (
    <View style={styles.header}>
      <Text style={styles.eyebrow}>
        {data.projectBusinessName ?? data.projectName}
      </Text>
      <Text style={styles.title}>{data.launchName}</Text>
      <Text style={styles.metaLine}>{meta.join("  ·  ")}</Text>
      {data.platforms.length > 0 && (
        <Text style={[styles.metaLine, { marginTop: 4 }]}>
          Plataformas: {data.platforms.join(", ")}
        </Text>
      )}
    </View>
  );
}

function KpiGrid({ kpi }: { kpi: LaunchKPIs }) {
  const cards: Array<{
    label: string;
    value: string;
    sub?: string;
    color?: string;
  }> = [
    { label: "Revenue estimado", value: money(kpi.revenueEstimated) },
    { label: "Revenue cobrado", value: money(kpi.revenueCollected) },
    { label: "Inversión", value: money(kpi.totalInvestment) },
    {
      label: "Profit estimado",
      value: money(kpi.profitEstimated),
      color: kpi.profitEstimated >= 0 ? COLORS.success : COLORS.error,
    },
    {
      label: "Profit real",
      value: money(kpi.profitReal),
      color: kpi.profitReal >= 0 ? COLORS.success : COLORS.error,
    },
    {
      label: "ROAS estimado",
      value: multiplier(kpi.roasEstimated),
      color: kpi.roasEstimated >= 1 ? COLORS.success : COLORS.error,
    },
    {
      label: "ROAS real",
      value: multiplier(kpi.roasReal),
      color: kpi.roasReal >= 1 ? COLORS.success : COLORS.error,
    },
    { label: "CAC", value: money(kpi.cac), sub: `${int(kpi.ventas)} ventas` },
    {
      label: "Leads totales",
      value: int(kpi.totalLeads),
      sub: `${int(kpi.registrados)} registrados`,
    },
    {
      label: "Show rate",
      value: percent(kpi.showRate),
      sub: `${int(kpi.asistentes)} asistieron`,
    },
    {
      label: "Close rate",
      value: percent(kpi.closeRate),
      sub: `${int(kpi.ventas)} cerradas`,
    },
  ];

  return (
    <View style={styles.kpiGrid}>
      {cards.map((c) => (
        <View key={c.label} style={styles.kpiCard}>
          <Text style={styles.kpiLabel}>{c.label}</Text>
          <Text style={[styles.kpiValue, c.color ? { color: c.color } : {}]}>
            {c.value}
          </Text>
          {c.sub && <Text style={styles.kpiSub}>{c.sub}</Text>}
        </View>
      ))}
    </View>
  );
}

function Timeline({ calendar }: { calendar: LaunchCalendar }) {
  const rows: Array<{ stage: string; range: string }> = [
    {
      stage: "Captación",
      range: `${fmtDate(calendar.captacion.startDate)} → ${fmtDate(calendar.captacion.endDate)}`,
    },
    {
      stage: "Calentamiento",
      range: `${fmtDate(calendar.calentamiento.startDate)} → ${fmtDate(calendar.calentamiento.endDate)}`,
    },
    {
      stage: "Clases",
      range: `${fmtDate(calendar.consumo.clase1)} · ${fmtDate(calendar.consumo.clase2)} · ${fmtDate(calendar.consumo.clase3)}`,
    },
    {
      stage: "Compra",
      range: `${fmtDate(calendar.compra.startDate)} → ${fmtDate(calendar.compra.endDate)}`,
    },
    {
      stage: "Cierre",
      range: `${fmtDate(calendar.cierre.startDate)} → ${fmtDate(calendar.cierre.endDate)}`,
    },
  ];

  return (
    <View>
      {rows.map((r) => (
        <View key={r.stage} style={styles.timelineRow}>
          <Text style={styles.timelineStage}>{r.stage}</Text>
          <Text style={styles.timelineRange}>{r.range}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * Chart de barras de inversión diaria (spend total = meta + google + tiktok
 * por día). Pintado a mano con `<Svg>` porque Recharts es client-only y no
 * corre en server. Stack vertical para distinguir contribución por provider.
 */
function DailySpendChart({ rows }: { rows: ReadonlyArray<MergedDailyRow> }) {
  const width = 530;
  const height = 110;
  const padLeft = 32;
  const padBottom = 18;
  const padTop = 6;
  const padRight = 8;

  const innerWidth = width - padLeft - padRight;
  const innerHeight = height - padTop - padBottom;

  const totals = rows.map((r) => r.meta_spend + r.google_spend + r.tiktok_spend);
  const maxSpend = Math.max(1, ...totals);
  const barSlot = innerWidth / Math.max(1, rows.length);
  const barWidth = Math.max(1, Math.min(barSlot - 1, 14));

  // Ticks del eje Y: 0, max/2, max — sólo 3 etiquetas para no saturar
  const yTicks = [0, maxSpend / 2, maxSpend];

  return (
    <View style={{ marginTop: 4 }}>
      <Svg width={width} height={height}>
        {/* Y-axis ticks + grid */}
        {yTicks.map((value, i) => {
          const y = padTop + innerHeight * (1 - value / maxSpend);
          return (
            <Path
              key={`grid-${i}`}
              d={`M ${padLeft} ${y} L ${width - padRight} ${y}`}
              stroke={COLORS.border}
              strokeWidth={0.5}
            />
          );
        })}

        {yTicks.map((value, i) => {
          const y = padTop + innerHeight * (1 - value / maxSpend);
          return (
            <SvgLabel
              key={`tick-${i}`}
              x={padLeft - 4}
              y={y + 3}
              fontSize={6}
              fill={COLORS.fgSubtle}
              textAnchor="end"
            >
              {money(value, true)}
            </SvgLabel>
          );
        })}

        {/* Bars (stacked por provider) */}
        {rows.map((row, idx) => {
          const xCenter = padLeft + barSlot * idx + barSlot / 2;
          const x = xCenter - barWidth / 2;
          let yCursor = padTop + innerHeight;

          const segments: Array<{ value: number; color: string }> = [
            { value: row.meta_spend, color: COLORS.meta },
            { value: row.google_spend, color: COLORS.google },
            { value: row.tiktok_spend, color: COLORS.tiktok },
          ];

          return segments.map((seg, sIdx) => {
            if (seg.value <= 0) return null;
            const h = (seg.value / maxSpend) * innerHeight;
            const y = yCursor - h;
            yCursor = y;
            return (
              <Rect
                key={`bar-${idx}-${sIdx}`}
                x={x}
                y={y}
                width={barWidth}
                height={h}
                fill={seg.color}
              />
            );
          });
        })}

        {/* X-axis line */}
        <Path
          d={`M ${padLeft} ${padTop + innerHeight} L ${width - padRight} ${padTop + innerHeight}`}
          stroke={COLORS.fgMuted}
          strokeWidth={0.5}
        />

        {/* X-axis: primera y última fecha (más no entran) */}
        {rows.length > 0 && (
          <>
            <SvgLabel
              x={padLeft}
              y={height - 4}
              fontSize={6}
              fill={COLORS.fgSubtle}
            >
              {fmtDate(rows[0]!.date)}
            </SvgLabel>
            <SvgLabel
              x={width - padRight}
              y={height - 4}
              fontSize={6}
              fill={COLORS.fgSubtle}
              textAnchor="end"
            >
              {fmtDate(rows[rows.length - 1]!.date)}
            </SvgLabel>
          </>
        )}
      </Svg>

      {/* Leyenda */}
      <View style={{ flexDirection: "row", gap: 12, marginTop: 4 }}>
        <Legend color={COLORS.meta} label="Meta" />
        <Legend color={COLORS.google} label="Google" />
        <Legend color={COLORS.tiktok} label="TikTok" />
      </View>
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <View style={{ width: 8, height: 8, backgroundColor: color, borderRadius: 2 }} />
      <Text style={{ fontSize: 7, color: COLORS.fgMuted }}>{label}</Text>
    </View>
  );
}

function ChannelBreakdown({ kpi }: { kpi: LaunchKPIs }) {
  const rows = [
    {
      name: "Meta",
      color: COLORS.meta,
      invest: kpi.metaInv,
      leads: kpi.metaLeads,
      cpl: kpi.cplMeta,
    },
    {
      name: "Google",
      color: COLORS.google,
      invest: kpi.googleInv,
      leads: kpi.googleLeads,
      cpl: kpi.cplGoogle,
    },
    {
      name: "TikTok",
      color: COLORS.tiktok,
      invest: kpi.tiktokInv,
      leads: kpi.tiktokLeads,
      cpl: kpi.cplTiktok,
    },
  ];

  return (
    <View>
      {rows.map((r) => (
        <View key={r.name} style={styles.channelRow}>
          <View style={[styles.channelDot, { backgroundColor: r.color }]} />
          <Text style={styles.channelName}>{r.name}</Text>
          <Text style={styles.channelMetric}>Inversión: {money(r.invest)}</Text>
          <Text style={styles.channelMetric}>Leads: {int(r.leads)}</Text>
          <Text style={styles.channelMetric}>CPL: {moneyDecimals(r.cpl)}</Text>
        </View>
      ))}
    </View>
  );
}

// ─── Renderer público ──────────────────────────────────────────────────────

/**
 * Renderiza el documento a Buffer para que el route handler lo mande directo
 * con `Content-Type: application/pdf`. En server, `pdf().toBuffer()` devuelve
 * un `NodeJS.ReadableStream`; lo consumimos en memoria. A 1-2 páginas el
 * tamaño esperado es <100KB — el stream no aporta beneficio acá.
 */
export async function renderExecutiveLaunchPdf(
  input: ExecutiveLaunchInput,
): Promise<Buffer> {
  const stream = await pdf(<ExecutiveLaunchDocument data={input} />).toBuffer();
  return await streamToBuffer(stream);
}

function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

// ─── helpers de formateo locales ───────────────────────────────────────────

function money(n: number, compact = false): string {
  if (compact && Math.abs(n) >= 1000) {
    return "$" + Math.round(n / 1000) + "k";
  }
  return "$" + Math.round(n).toLocaleString("en-US");
}

function moneyDecimals(n: number): string {
  return (
    "$" +
    n.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function int(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function percent(n: number): string {
  return n.toFixed(1) + "%";
}

function multiplier(n: number): string {
  return n.toFixed(2) + "x";
}

/**
 * Atajo para labels dentro de un `<Svg>`. react-pdf soporta `fontSize` en su
 * `<Text>` cuando vive dentro de un Svg (el renderer pdfkit lo aplica), pero
 * los tipos de `SVGTextProps` no lo declaran. Encapsulamos el cast acá para
 * que el resto del archivo quede tipado limpio.
 */
function SvgLabel(props: {
  x: number;
  y: number;
  fontSize?: number;
  fill?: string;
  textAnchor?: "start" | "middle" | "end";
  children: React.ReactNode;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <Text {...(props as any)} />;
}

