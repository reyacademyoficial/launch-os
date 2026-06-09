import type { LaunchDailyRow } from "./types";

/**
 * Regla manual vs API (decisión del brief Fase 3a):
 *  - Para cada (date, ad_channel), si hay dato en API (launch_daily_ads
 *    con provider que mapea a ese canal) → manda el de API.
 *  - Para los canales no-pagos (organico, whatsapp, referidos, otro) →
 *    siempre manual.
 *  - NO se suman manual + API: la regla es override, no acumulación.
 *
 * Por qué override y no suma: si el usuario cargó manualmente y después la
 * API trae el mismo período, sumarlos duplica. Override es seguro porque la
 * API es la fuente más confiable del lado de ads — el manual queda como
 * fallback hasta que el sync cubra ese día.
 *
 * Pura función — testeable, sin side effects.
 */

export type AdsProvider = "meta" | "google" | "tiktok";

const PROVIDER_TO_CHANNEL: Record<AdsProvider, "meta_ads" | "google_ads" | "tiktok_ads"> = {
  meta: "meta_ads",
  google: "google_ads",
  tiktok: "tiktok_ads",
};

/** Subset de `launch_daily_ads` necesario para el merge. */
export interface AdsDailyRow {
  date: string;
  provider: string;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
}

/**
 * Resultado del merge: una fila por día con leads efectivos por canal +
 * spend/clicks/impressions de la API (que no tienen equivalente manual).
 */
export interface MergedDailyRow {
  date: string;
  // Leads por canal — efectivos (API gana sobre manual).
  meta_ads: number;
  google_ads: number;
  tiktok_ads: number;
  organico: number;
  whatsapp: number;
  referidos: number;
  otro: number;
  // Métricas que solo vienen de API.
  meta_spend: number;
  meta_clicks: number;
  meta_impressions: number;
  google_spend: number;
  google_clicks: number;
  google_impressions: number;
  tiktok_spend: number;
  tiktok_clicks: number;
  tiktok_impressions: number;
}

interface PartialMerged extends MergedDailyRow {
  // Flag interna para saber qué canales ya pisó la API y no copiar el manual.
  apiCovered: Set<string>;
}

function emptyRow(date: string): PartialMerged {
  return {
    date,
    meta_ads: 0,
    google_ads: 0,
    tiktok_ads: 0,
    organico: 0,
    whatsapp: 0,
    referidos: 0,
    otro: 0,
    meta_spend: 0,
    meta_clicks: 0,
    meta_impressions: 0,
    google_spend: 0,
    google_clicks: 0,
    google_impressions: 0,
    tiktok_spend: 0,
    tiktok_clicks: 0,
    tiktok_impressions: 0,
    apiCovered: new Set(),
  };
}

/**
 * Toma los rows manuales (launch_daily) y los rows API (launch_daily_ads) y
 * los compone en un array por día siguiendo la regla.
 */
export function mergeDailyData(
  manual: ReadonlyArray<LaunchDailyRow>,
  ads: ReadonlyArray<AdsDailyRow>,
): MergedDailyRow[] {
  const byDate = new Map<string, PartialMerged>();

  // Paso 1: aplicar los rows de la API primero — quedan como "ground truth"
  // para sus canales.
  for (const row of ads) {
    if (!isAdsProvider(row.provider)) continue;
    const channel = PROVIDER_TO_CHANNEL[row.provider];

    let entry = byDate.get(row.date);
    if (!entry) {
      entry = emptyRow(row.date);
      byDate.set(row.date, entry);
    }
    entry[channel] = row.leads;
    entry.apiCovered.add(channel);

    if (row.provider === "meta") {
      entry.meta_spend = row.spend;
      entry.meta_clicks = row.clicks;
      entry.meta_impressions = row.impressions;
    } else if (row.provider === "google") {
      entry.google_spend = row.spend;
      entry.google_clicks = row.clicks;
      entry.google_impressions = row.impressions;
    } else if (row.provider === "tiktok") {
      entry.tiktok_spend = row.spend;
      entry.tiktok_clicks = row.clicks;
      entry.tiktok_impressions = row.impressions;
    }
  }

  // Paso 2: los rows manuales rellenan lo que la API no cubrió.
  for (const row of manual) {
    let entry = byDate.get(row.date);
    if (!entry) {
      entry = emptyRow(row.date);
      byDate.set(row.date, entry);
    }
    if (!entry.apiCovered.has("meta_ads")) entry.meta_ads = row.meta_ads;
    if (!entry.apiCovered.has("google_ads")) entry.google_ads = row.google_ads;
    if (!entry.apiCovered.has("tiktok_ads")) entry.tiktok_ads = row.tiktok_ads;
    // Canales no-pagos siempre manual.
    entry.organico = row.organico;
    entry.whatsapp = row.whatsapp;
    entry.referidos = row.referidos;
    entry.otro = row.otro;
  }

  // Paso 3: tirar la flag interna + ordenar por fecha ascendente.
  const result: MergedDailyRow[] = [];
  for (const partial of byDate.values()) {
    const { apiCovered: _omit, ...row } = partial;
    void _omit;
    result.push(row);
  }
  result.sort((a, b) => a.date.localeCompare(b.date));
  return result;
}

function isAdsProvider(value: string): value is AdsProvider {
  return value === "meta" || value === "google" || value === "tiktok";
}
