import type { Database } from "@/lib/types/database";

export type LaunchDailyRow = Database["public"]["Tables"]["launch_daily"]["Row"];

export const DAILY_CHANNELS = [
  "meta_ads",
  "google_ads",
  "tiktok_ads",
  "organico",
  "whatsapp",
  "referidos",
  "otro",
] as const;

export type DailyChannel = (typeof DAILY_CHANNELS)[number];

export const CHANNEL_LABELS: Record<DailyChannel, string> = {
  meta_ads: "Meta Ads",
  google_ads: "Google Ads",
  tiktok_ads: "TikTok Ads",
  organico: "Orgánico",
  whatsapp: "WhatsApp",
  referidos: "Referidos",
  otro: "Otro",
};

/** Brand colors ported from the prototype — kept hardcoded so they survive theme changes. */
export const CHANNEL_COLORS: Record<DailyChannel, string> = {
  meta_ads: "#4285F4",
  google_ads: "#34A853",
  tiktok_ads: "#FF0050",
  organico: "#c084fc",
  whatsapp: "#25D366",
  referidos: "#FF6B35",
  otro: "#71717A",
};

export function dailyTotal(row: LaunchDailyRow): number {
  return DAILY_CHANNELS.reduce((sum, ch) => sum + row[ch], 0);
}
