import type { Database } from "@/lib/types/database";

export type ProjectIntegrationRow =
  Database["public"]["Tables"]["project_integrations"]["Row"];

export interface ProviderConfig {
  /** Stable id, used as `project_integrations.provider`. */
  id: string;
  name: string;
  /** Single-letter badge for the icon square. */
  glyph: string;
  /** Hex color; used for the icon background tint + status accents. */
  color: string;
  /** Human label for the account/identifier field. */
  accountLabel: string;
  accountPlaceholder: string;
  /** Human label for the secret field — kept generic so it works for keys or tokens. */
  secretLabel: string;
}

/**
 * Single source of truth for which integrations the UI exposes. Adding a
 * provider here makes a card appear; nothing else in the codebase needs to
 * know specific provider ids.
 */
export const PROVIDERS: readonly ProviderConfig[] = [
  {
    id: "meta",
    name: "Meta Ads",
    glyph: "M",
    color: "#4285F4",
    accountLabel: "Account ID",
    accountPlaceholder: "act_1234567890",
    secretLabel: "Access token",
  },
  {
    id: "google",
    name: "Google Ads",
    glyph: "G",
    color: "#34A853",
    accountLabel: "Customer ID",
    accountPlaceholder: "123-456-7890",
    secretLabel: "Refresh token",
  },
  {
    id: "tiktok",
    name: "TikTok Ads",
    glyph: "T",
    color: "#FF0050",
    accountLabel: "Advertiser ID",
    accountPlaceholder: "7234567890",
    secretLabel: "Access token",
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    glyph: "W",
    color: "#25D366",
    accountLabel: "Phone Number ID",
    accountPlaceholder: "10987654321",
    secretLabel: "Permanent token",
  },
  {
    id: "sendflow",
    name: "SendFlow",
    glyph: "S",
    color: "#FF6B35",
    accountLabel: "Workspace ID",
    accountPlaceholder: "ws_abc123",
    secretLabel: "API key",
  },
  {
    id: "ghl",
    name: "Go High Level",
    glyph: "G",
    color: "#7C3AED",
    accountLabel: "Subaccount ID",
    accountPlaceholder: "abc123",
    secretLabel: "API key",
  },
];

export const PROVIDER_IDS = PROVIDERS.map((p) => p.id);

export function isValidProviderId(value: string): boolean {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}
