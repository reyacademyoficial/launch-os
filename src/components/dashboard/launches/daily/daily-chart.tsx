"use client";

import { KgLineChart, type KgChartSeries } from "@/components/kg/line-chart";
import {
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
 * Este archivo lo consumen DOS rutas: el tab KPI del dashboard interno y el
 * portal de cliente. Los props públicos (`rows`, `overlayPartialNote`) y el
 * `DailyChartRow` exportado NO cambian — sólo cambia con qué se dibuja.
 *
 * ── De recharts a mano a `KgLineChart` ────────────────────────────────────
 * Se fue: la paleta hardcodeada (`CHANNEL_COLORS` + `OVERLAY_COLORS`), la
 * `<Legend>` de recharts con toggle por click (no accesible por teclado), el
 * tooltip custom sobre tokens viejos (`--color-bg-elevated`, `--color-fg`) y
 * el `useState` del set de series ocultas — todo eso vive ahora en la
 * primitiva.
 *
 * 10 series contra una paleta de 8 slots: lo resuelve `dashed`. Los tres
 * overlays son conceptualmente otro grupo (comunidad / CRM, no canal de
 * lead), se dibujan punteados y toman su propio slot 1..3, así ningún par
 * comparte color DENTRO de su grupo. Es la misma lectura que daba el
 * `strokeDasharray="6 3"` de antes, ahora sin repetir hues entre grupos.
 *
 * El filtro de series sin datos lo hace `hideEmptySeries` (default true) —
 * reemplaza a los `activeChannels` / `activeOverlays` que se calculaban acá.
 *
 * Nota de attribution: el brief advierte que los totales NO van a coincidir
 * exactamente entre series (ventanas de atribución distintas; SMS puede
 * incluir mensajes no-WhatsApp). El chart es para comparación de FORMA, no
 * de totales — eso viaja en el `footNote`.
 */

const OVERLAY_KEYS = ["sendflow_add", "ghl_inbound", "ghl_new_leads"] as const;
type OverlayKey = (typeof OVERLAY_KEYS)[number];

const OVERLAY_LABELS: Record<OverlayKey, string> = {
  sendflow_add: "SendFlow altas",
  ghl_inbound: "WhatsApp/SMS in",
  ghl_new_leads: "Leads GHL",
};

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

// El orden importa: el slot de color se asigna por índice DENTRO de cada
// grupo (sólidas por un lado, punteadas por otro), y se calcula sobre este
// array declarado — no sobre el filtrado. Esconder una serie no repinta al
// resto.
const SERIES: readonly KgChartSeries[] = [
  ...DAILY_CHANNELS.map((ch) => ({ key: ch, label: CHANNEL_LABELS[ch] })),
  ...OVERLAY_KEYS.map((k) => ({
    key: k,
    label: OVERLAY_LABELS[k],
    dashed: true,
  })),
];

export function DailyChart({ rows, overlayPartialNote }: DailyChartProps) {
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

  const hasOverlay = OVERLAY_KEYS.some((k) => data.some((d) => d[k] > 0));

  return (
    <KgLineChart
      data={data}
      xKey="date"
      series={SERIES}
      height={280}
      yLabel="Leads / mensajes"
      allowDecimals={false}
      emptyTitle="Sin datos diarios en el rango"
      emptyHint="Hacen falta al menos dos días con leads cargados para dibujar la evolución."
      footNote={
        hasOverlay || overlayPartialNote ? (
          <>
            {hasOverlay && (
              <span>
                Las series de comunidad (punteadas) tienen ventanas de
                atribución distintas a las de Meta — los totales NO van a
                coincidir. Tocá una serie en la leyenda para ocultarla y
                comparar las curvas restantes.
              </span>
            )}
            {overlayPartialNote && (
              <span style={{ display: "block", marginTop: 4 }}>
                ⚠ {overlayPartialNote}
              </span>
            )}
          </>
        ) : undefined
      }
    />
  );
}
