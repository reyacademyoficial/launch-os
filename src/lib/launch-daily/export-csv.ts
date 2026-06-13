import "server-only";

import { CHANNEL_LABELS, DAILY_CHANNELS } from "./types";
import type { MergedDailyRow } from "./merge";

/**
 * Serializa los datos diarios de un lanzamiento (merge de manual + API) a CSV
 * para descarga directa. Mismo patrón que `lib/leads/export-csv.ts`:
 *
 *   - RFC 4180. Separador `,`. Newline `\r\n`.
 *   - Quoting solo cuando hace falta (valor con `,` `"` `\n` `\r`).
 *   - BOM UTF-8 al principio para que Excel detecte la codificación.
 *
 * Columnas:
 *   - "Fecha"
 *   - 7 columnas de leads por canal (Meta Ads / Google Ads / TikTok Ads /
 *     Orgánico / WhatsApp / Referidos / Otro). El label viene de
 *     `CHANNEL_LABELS` para no duplicar la traducción.
 *   - 9 columnas de métricas por provider que solo tienen sentido cuando hay
 *     sync (Meta / Google / TikTok x spend / clicks / impressions). Si no hubo
 *     sync, salen 0 — preferimos columnas estables a layouts variables.
 *
 * Mismas reglas de "API gana sobre manual" que el `mergeDailyData` ya
 * aplica antes: el caller pasa rows ya mergeadas; este módulo no las
 * recalcula.
 */

const CHANNEL_HEADERS = DAILY_CHANNELS.map((ch) => CHANNEL_LABELS[ch]);

const PROVIDER_HEADERS = [
  "Meta spend",
  "Meta clicks",
  "Meta impresiones",
  "Google spend",
  "Google clicks",
  "Google impresiones",
  "TikTok spend",
  "TikTok clicks",
  "TikTok impresiones",
] as const;

const HEADERS = ["Fecha", ...CHANNEL_HEADERS, ...PROVIDER_HEADERS];

export function buildDailyCsv(rows: ReadonlyArray<MergedDailyRow>): string {
  const lines: string[] = [];
  lines.push(HEADERS.map(csvField).join(","));

  for (const row of rows) {
    lines.push(
      [
        row.date,
        String(row.meta_ads),
        String(row.google_ads),
        String(row.tiktok_ads),
        String(row.organico),
        String(row.whatsapp),
        String(row.referidos),
        String(row.otro),
        String(row.meta_spend),
        String(row.meta_clicks),
        String(row.meta_impressions),
        String(row.google_spend),
        String(row.google_clicks),
        String(row.google_impressions),
        String(row.tiktok_spend),
        String(row.tiktok_clicks),
        String(row.tiktok_impressions),
      ]
        .map(csvField)
        .join(","),
    );
  }

  return `﻿${lines.join("\r\n")}\r\n`;
}

function csvField(value: string): string {
  if (value === "") return "";
  const needsQuoting =
    value.includes(",") ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r");
  if (!needsQuoting) return value;
  return `"${value.replace(/"/g, '""')}"`;
}
