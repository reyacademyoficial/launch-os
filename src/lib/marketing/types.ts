/**
 * Tipos compartidos del módulo Marketing.
 *
 * Los tipos siguen los CHECK constraints de las migraciones (0158+). Cambiar
 * un valor acá requiere actualizar el CHECK y viceversa — mantener el
 * repertorio sincronizado.
 */

export const MARKETING_PLATFORMS = [
  "instagram",
  "facebook",
  "tiktok",
  "youtube",
] as const;

export type MarketingPlatform = (typeof MARKETING_PLATFORMS)[number];

export const MARKETING_FORMATS = [
  "reel",
  "short",
  "long",
  "carousel",
  "story",
  "post",
] as const;

export type MarketingFormat = (typeof MARKETING_FORMATS)[number];

export const PLATFORM_LABEL: Record<MarketingPlatform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  youtube: "YouTube",
};

export const FORMAT_LABEL: Record<MarketingFormat, string> = {
  reel: "Reel",
  short: "Short",
  long: "Video largo",
  carousel: "Carrusel",
  story: "Historia",
  post: "Post",
};

export const MARKETING_CATEGORIES = ["viral", "nugget", "otro"] as const;

export type MarketingCategory = (typeof MARKETING_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<MarketingCategory, string> = {
  viral: "Viral",
  nugget: "Nugget",
  otro: "Otro",
};

export const MARKETING_STAGES = [
  "planificado",
  "en_grabacion",
  "en_edicion",
  "listo_para_subir",
  "publicado",
  "descartado",
] as const;

export type MarketingStage = (typeof MARKETING_STAGES)[number];

export const STAGE_LABEL: Record<MarketingStage, string> = {
  planificado: "Planificado",
  en_grabacion: "En grabación",
  en_edicion: "En edición",
  listo_para_subir: "Listo para subir",
  publicado: "Publicado",
  descartado: "Descartado",
};

/**
 * Tono semántico del stage. Usado por StatusPill/StateDot en la tabla.
 * Regla del proyecto: el número/texto nunca se pinta — el color vive en el
 * dot al lado. `neutral-500` para stages que no requieren atención (final).
 */
export const STAGE_TONE: Record<MarketingStage, string> = {
  planificado: "var(--kg-neutral-500)",
  en_grabacion: "var(--kg-accent-500)",
  en_edicion: "var(--kg-accent-500)",
  listo_para_subir: "var(--kg-warning-500)",
  publicado: "var(--kg-positive-500)",
  descartado: "var(--kg-neutral-500)",
};

export function isMarketingPlatform(v: string): v is MarketingPlatform {
  return (MARKETING_PLATFORMS as readonly string[]).includes(v);
}

export function isMarketingFormat(v: string): v is MarketingFormat {
  return (MARKETING_FORMATS as readonly string[]).includes(v);
}

export function isMarketingCategory(v: string): v is MarketingCategory {
  return (MARKETING_CATEGORIES as readonly string[]).includes(v);
}

export function isMarketingStage(v: string): v is MarketingStage {
  return (MARKETING_STAGES as readonly string[]).includes(v);
}

// ═══════════════════════════════════════════════════════════════════════════
// Row shapes (mirror de las columnas leídas del server — subset típico).
// ═══════════════════════════════════════════════════════════════════════════

export interface ContentOwnerRow {
  readonly id: string;
  readonly name: string;
  readonly handleInstagram: string | null;
  readonly handleFacebook: string | null;
  readonly handleTiktok: string | null;
  readonly handleYoutube: string | null;
  readonly notes: string | null;
  readonly active: boolean;
}

export interface PublishingCadenceRow {
  readonly contentOwnerId: string;
  readonly platform: MarketingPlatform;
  readonly format: MarketingFormat;
  readonly postsPerDay: number;
  readonly allowRepeatAsset: boolean;
  readonly notes: string | null;
}

export interface ContentPieceRow {
  readonly id: string;
  readonly contentOwnerId: string;
  readonly title: string;
  readonly scriptMd: string | null;
  readonly category: MarketingCategory;
  readonly format: MarketingFormat;
  readonly platforms: readonly MarketingPlatform[];
  readonly scheduledRecordingAt: string | null;
  readonly scheduledPublishAt: string | null;
  readonly stage: MarketingStage;
  readonly recordingSessionId: string | null;
  readonly isDailyRecurring: boolean;
  readonly notes: string | null;
}
