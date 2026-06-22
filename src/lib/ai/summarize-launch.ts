import "server-only";

import {
  fmtMoney,
  fmtMoneyDecimals,
  fmtMultiplier,
  fmtNumber,
  fmtPercent,
  fmtPercentOrDash,
} from "@/lib/format";
import { calculateLaunchKPIs } from "@/lib/kpis";
import { aggregateMergedDaily } from "@/lib/launch-daily/aggregate";
import { mergeDailyData, type AdsDailyRow } from "@/lib/launch-daily/merge";
import type { LaunchDailyRow } from "@/lib/launch-daily/types";
import { DAILY_CHANNELS, CHANNEL_LABELS } from "@/lib/launch-daily/types";
import type { KanbanSalesAggregate } from "@/lib/launch-sales/aggregate";
import type { LaunchRow } from "@/lib/launches/types";

import { generateText } from "./client";

const SYSTEM_PROMPT = `Sos un analista senior de marketing digital. Tu trabajo es leer las métricas de un lanzamiento y devolver un resumen ejecutivo accionable.

Devolvé la respuesta en MARKDOWN, con esta estructura exacta:

## Lo que funcionó
- Punto 1
- Punto 2
- (opcional: Punto 3)

## Lo que no funcionó
- Punto 1
- Punto 2
- (opcional: Punto 3)

## Recomendaciones para el próximo lanzamiento
1. Acción concreta y priorizada
2. Acción concreta y priorizada
3. (opcional: tercera)

Reglas duras:
- Respondé en español rioplatense, máximo 350 palabras.
- Usá los KPIs provistos tal cual; no inventes números.
- Si faltan datos en algún canal, decilo explícito en vez de improvisar.
- Sé directo, sin clichés ("¡increíble resultado!"). Hablás con el dueño del lanzamiento.
- Usá **negrita** para resaltar métricas o números clave dentro de los puntos.
- NO incluyas un h1 ni un título general — la página ya tiene "Resumen ejecutivo" como header.`;

export async function summarizeLaunch(
  launch: LaunchRow,
  daily: readonly LaunchDailyRow[],
  ads: readonly AdsDailyRow[] = [],
  kanbanSalesAggregate?: KanbanSalesAggregate,
): Promise<string> {
  // Mismo derive que el resto de los call sites — el resumen IA tiene que
  // ver los mismos números que el KPI grid del detalle, sino el modelo
  // analiza un launch fantasma.
  const merged = mergeDailyData(daily, ads);
  const adsAggregate = aggregateMergedDaily(merged);
  const kpi = calculateLaunchKPIs(launch, {
    adsAggregate,
    kanbanSalesAggregate,
  });
  const prompt = buildUserPrompt(launch, daily, kpi);
  return generateText({ system: SYSTEM_PROMPT, user: prompt });
}

function buildUserPrompt(
  launch: LaunchRow,
  daily: readonly LaunchDailyRow[],
  kpi: ReturnType<typeof calculateLaunchKPIs>,
): string {
  const lines: string[] = [];

  lines.push(`Lanzamiento: ${launch.name}`);
  if (launch.date_start && launch.date_end) {
    lines.push(`Ventana: ${launch.date_start} → ${launch.date_end}`);
  } else if (launch.date_start) {
    lines.push(`Inicio: ${launch.date_start}`);
  } else if (launch.date) {
    // Legacy fallback for rows pre-migration 0006 where only `date` was set.
    lines.push(`Fecha: ${launch.date}`);
  }
  if (launch.closed_at) lines.push(`Cerrado: ${launch.closed_at}`);
  if (launch.type) lines.push(`Tipo: ${launch.type}`);
  if (launch.status) lines.push(`Status: ${launch.status}`);
  if (launch.platforms.length > 0) {
    lines.push(`Plataformas: ${launch.platforms.join(", ")}`);
  }

  lines.push("", "Inversión por canal:");
  lines.push(`- Meta: ${fmtMoney(kpi.metaInv)} (${fmtNumber(kpi.metaLeads)} leads, CPL ${fmtMoneyDecimals(kpi.cplMeta)})`);
  lines.push(`- Google: ${fmtMoney(kpi.googleInv)} (${fmtNumber(kpi.googleLeads)} leads, CPL ${fmtMoneyDecimals(kpi.cplGoogle)})`);
  lines.push(`- TikTok: ${fmtMoney(kpi.tiktokInv)} (${fmtNumber(kpi.tiktokLeads)} leads, CPL ${fmtMoneyDecimals(kpi.cplTiktok)})`);
  lines.push(`- Total inversión: ${fmtMoney(kpi.totalInvestment)}`);
  lines.push(`- Leads totales (ads): ${fmtNumber(kpi.totalLeads)}`);

  lines.push("", "Funnel:");
  lines.push(`- Inscriptos: ${fmtNumber(kpi.registrados)}`);
  lines.push(`- Asistentes Clase 1 (pico): ${fmtNumber(kpi.asistentes)} (show rate ${fmtPercentOrDash(kpi.showRate)})`);
  lines.push(`- Asistentes Clase 3 / pitch (pico): ${fmtNumber(kpi.hastaPitch)} (close rate C1→C3 ${fmtPercentOrDash(kpi.closeRate)})`);
  lines.push(`- Ventas: ${fmtNumber(kpi.ventas)} (close rate hasta el pitch ${fmtPercentOrDash(kpi.closeRateC3)})`);

  lines.push("", "Revenue + economics:");
  lines.push(`- Revenue estimado (pactado): ${fmtMoney(kpi.revenueEstimated)}`);
  lines.push(`- Revenue cobrado (real): ${fmtMoney(kpi.revenueCollected)}`);
  lines.push(`- Ingresos via WhatsApp: ${fmtMoney(kpi.whatsappRevenue)} (${fmtPercent(kpi.whatsappRevenueShare)} del revenue estimado)`);
  lines.push(`- ROAS estimado: ${fmtMultiplier(kpi.roasEstimated)}`);
  lines.push(`- ROAS real (sobre cobrado): ${fmtMultiplier(kpi.roasReal)}`);
  lines.push(`- CAC: ${fmtMoneyDecimals(kpi.cac)}`);
  lines.push(`- Profit estimado: ${fmtMoney(kpi.profitEstimated)}`);
  lines.push(`- Profit real (sobre cobrado): ${fmtMoney(kpi.profitReal)}`);

  if (daily.length > 0) {
    lines.push("", "Leads por día por canal:");
    const sorted = [...daily].sort((a, b) => a.date.localeCompare(b.date));
    for (const row of sorted) {
      const breakdown = DAILY_CHANNELS.filter((ch) => row[ch] > 0)
        .map((ch) => `${CHANNEL_LABELS[ch]} ${row[ch]}`)
        .join(", ");
      lines.push(`- ${row.date}: ${breakdown || "sin datos"}`);
    }
  } else {
    lines.push("", "Sin datos diarios cargados.");
  }

  lines.push(
    "",
    "Devolveme el análisis siguiendo la estructura del system prompt.",
  );

  return lines.join("\n");
}
