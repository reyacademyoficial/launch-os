"use client";

import { useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  CHANNEL_COLORS,
  CHANNEL_LABELS,
  DAILY_CHANNELS,
  type DailyChannel,
} from "@/lib/launch-daily/types";

/**
 * Leads-per-day-per-channel line chart con overlay opcional (Fase B):
 *  - Series existentes: canales de lead (meta_ads, organico, whatsapp, etc.).
 *  - Serie `sendflow_add`: altas diarias de comunidad SendFlow.
 *  - Serie `ghl_inbound`: mensajes WhatsApp/SMS entrantes por día (GHL).
 *  - Serie `ghl_new_leads`: contacts nuevos por día en GHL (leads captados).
 *
 * Leyenda interactiva: click en una serie la oculta/muestra (estado local).
 * Tooltip muestra solo las series activas. Series sin data en TODO el rango
 * no se renderizan — la leyenda no se llena de líneas planas.
 *
 * Cliente component porque maneja estado de visibilidad. Las páginas server
 * que lo importan solo pasan rows pre-merged.
 *
 * Nota de attribution: el brief advierte que los totales NO van a coincidir
 * exactamente entre series (ventanas de atribución distintas; SMS puede incluir
 * mensajes no-WhatsApp). El chart es para comparación de FORMA, no de totales.
 */

const OVERLAY_KEYS = ["sendflow_add", "ghl_inbound", "ghl_new_leads"] as const;
type OverlayKey = (typeof OVERLAY_KEYS)[number];

const OVERLAY_LABELS: Record<OverlayKey, string> = {
  sendflow_add: "SendFlow altas",
  ghl_inbound: "WhatsApp/SMS in",
  ghl_new_leads: "Leads GHL",
};

/**
 * Colores elegidos para que NO choquen con los de canales (ver
 * CHANNEL_COLORS). SendFlow = violeta (comunidad, fuera del funnel pago).
 * GHL inbound = cyan (mensajes). GHL new leads = ámbar (captación distinta
 * a los mensajes y al canal manual whatsapp).
 */
const OVERLAY_COLORS: Record<OverlayKey, string> = {
  sendflow_add: "#a855f7",
  ghl_inbound: "#06b6d4",
  ghl_new_leads: "#f59e0b",
};

type SeriesKey = DailyChannel | OverlayKey;

export type DailyChartRow = { date: string } & Record<DailyChannel, number> & {
  sendflow_add?: number;
  ghl_inbound?: number;
  ghl_new_leads?: number;
};

export interface DailyChartProps {
  readonly rows: readonly DailyChartRow[];
  /**
   * Estado partial del último sync de overlay — si está set, mostramos una
   * nota al pie. Brief: "si SendFlow trae partial o GHL pega hit_max_pages,
   * surface el estado, no abortes".
   */
  readonly overlayPartialNote?: string | null;
}

export function DailyChart({ rows, overlayPartialNote }: DailyChartProps) {
  // Estado de visibilidad por serie. Default: todas visibles. Click en
  // leyenda flipea. Set para que el delete sea O(1).
  const [hidden, setHidden] = useState<Set<SeriesKey>>(() => new Set());

  if (rows.length === 0) return null;

  const data = [...rows]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) => ({
      date: r.date,
      meta_ads: r.meta_ads,
      google_ads: r.google_ads,
      tiktok_ads: r.tiktok_ads,
      organico: r.organico,
      whatsapp: r.whatsapp,
      referidos: r.referidos,
      otro: r.otro,
      sendflow_add: r.sendflow_add ?? 0,
      ghl_inbound: r.ghl_inbound ?? 0,
      ghl_new_leads: r.ghl_new_leads ?? 0,
    }));

  // Solo dibujamos lineas con al menos un día > 0 (igual que el chart pre-B).
  const activeChannels = DAILY_CHANNELS.filter((ch) =>
    data.some((d) => d[ch] > 0),
  );
  const activeOverlays = OVERLAY_KEYS.filter((k) =>
    data.some((d) => d[k] > 0),
  );

  const toggle = (key: SeriesKey) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="space-y-2">
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 8, right: 16, left: 16, bottom: 36 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis
              dataKey="date"
              stroke="var(--color-fg-muted)"
              tick={{ fontSize: 11 }}
              tickMargin={6}
              label={{
                value: "Fecha",
                position: "insideBottom",
                offset: -16,
                fill: "var(--color-fg-muted)",
                fontSize: 12,
              }}
            />
            <YAxis
              stroke="var(--color-fg-muted)"
              tick={{ fontSize: 11 }}
              allowDecimals={false}
              width={48}
              label={{
                value: "Leads / mensajes",
                angle: -90,
                position: "insideLeft",
                offset: 8,
                fill: "var(--color-fg-muted)",
                fontSize: 12,
                style: { textAnchor: "middle" },
              }}
            />
            <Tooltip
              content={
                <CustomTooltip hidden={hidden} />
              }
            />
            <Legend
              verticalAlign="top"
              align="right"
              height={28}
              wrapperStyle={{ fontSize: 12, cursor: "pointer" }}
              onClick={(entry) => {
                // Recharts emite el dataKey en la entry — lo usamos como
                // identificador de serie.
                const dataKey = (entry as { dataKey?: string }).dataKey;
                if (typeof dataKey === "string") {
                  toggle(dataKey as SeriesKey);
                }
              }}
            />
            {activeChannels.map((ch) => (
              <Line
                key={ch}
                type="monotone"
                dataKey={ch}
                stroke={CHANNEL_COLORS[ch]}
                strokeWidth={2}
                dot={{ r: 2 }}
                activeDot={{ r: 4 }}
                connectNulls
                name={CHANNEL_LABELS[ch]}
                hide={hidden.has(ch)}
              />
            ))}
            {activeOverlays.map((k) => (
              <Line
                key={k}
                type="monotone"
                dataKey={k}
                stroke={OVERLAY_COLORS[k]}
                strokeWidth={2}
                strokeDasharray="6 3"
                dot={{ r: 2 }}
                activeDot={{ r: 4 }}
                connectNulls
                name={OVERLAY_LABELS[k]}
                hide={hidden.has(k)}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {(activeOverlays.length > 0 || overlayPartialNote) && (
        <div className="space-y-1 px-2 text-[11px] text-fg-subtle">
          {activeOverlays.length > 0 && (
            <p>
              Las series de comunidad (SendFlow, WhatsApp/SMS) tienen ventanas
              de atribución distintas a las de Meta — los totales NO van a
              coincidir. Click en una serie de la leyenda para ocultarla y
              comparar las curvas restantes.
            </p>
          )}
          {overlayPartialNote && (
            <p className="text-warning">⚠ {overlayPartialNote}</p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Tooltip custom — filtra las series ocultas (Recharts las sigue mandando en
 * payload aunque `hide` esté true). Conserva el styling original del chart.
 */
function CustomTooltip({
  active,
  payload,
  label,
  hidden,
}: {
  readonly active?: boolean;
  readonly payload?: ReadonlyArray<{
    dataKey?: string | number;
    name?: string;
    value?: number;
    color?: string;
  }>;
  readonly label?: string;
  readonly hidden: Set<SeriesKey>;
}) {
  if (!active || !payload || payload.length === 0) return null;

  const visible = payload.filter((p) => {
    if (typeof p.dataKey !== "string") return false;
    return !hidden.has(p.dataKey as SeriesKey);
  });
  if (visible.length === 0) return null;

  return (
    <div
      style={{
        background: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border)",
        borderRadius: "6px",
        padding: "8px 10px",
        fontSize: "12px",
        color: "var(--color-fg)",
      }}
    >
      <div style={{ marginBottom: 4, fontWeight: 600 }}>{label}</div>
      {visible.map((p) => (
        <div
          key={String(p.dataKey)}
          style={{ display: "flex", alignItems: "center", gap: 6 }}
        >
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: p.color ?? "var(--color-fg-muted)",
            }}
          />
          <span>{p.name}:</span>
          <span style={{ fontWeight: 600 }}>{p.value ?? 0}</span>
        </div>
      ))}
    </div>
  );
}
