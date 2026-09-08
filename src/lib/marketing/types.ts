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

// 0192: se redujo de 6 valores (reel/short/long/carousel/story/post) a estos
// 5 — "formato" en este módulo no es el layout de publicación sino el TIPO
// de pieza (para poder medir capacidad de edición por tipo). Los formatos
// viejos se remapearon en la migración: short→reel, carousel/story/post→otro.
export const MARKETING_FORMATS = [
  "otro",
  "nugget",
  "anuncios",
  "reel",
  "long",
] as const;

export type MarketingFormat = (typeof MARKETING_FORMATS)[number];

export const PLATFORM_LABEL: Record<MarketingPlatform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  youtube: "YouTube",
};

export const FORMAT_LABEL: Record<MarketingFormat, string> = {
  otro: "Otro",
  nugget: "Nuggets",
  anuncios: "Anuncios",
  reel: "Reel",
  long: "Video largo",
};

export const MARKETING_CATEGORIES = [
  "viral",
  "nugget",
  "anuncios",
  "otro",
] as const;

export type MarketingCategory = (typeof MARKETING_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<MarketingCategory, string> = {
  viral: "Viral",
  nugget: "Nuggets",
  anuncios: "Anuncios",
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
// Recording sessions (0160) + assignees (0161)
// ═══════════════════════════════════════════════════════════════════════════

export const RECORDING_SESSION_STATUSES = [
  "planificada",
  "confirmada",
  "realizada",
  "cancelada",
] as const;

export type RecordingSessionStatus = (typeof RECORDING_SESSION_STATUSES)[number];

export const SESSION_STATUS_LABEL: Record<RecordingSessionStatus, string> = {
  planificada: "Planificada",
  confirmada: "Confirmada",
  realizada: "Realizada",
  cancelada: "Cancelada",
};

export const SESSION_STATUS_TONE: Record<RecordingSessionStatus, string> = {
  planificada: "var(--kg-neutral-500)",
  confirmada: "var(--kg-accent-500)",
  realizada: "var(--kg-positive-500)",
  cancelada: "var(--kg-negative-500)",
};

export const RECORDING_ROLES = [
  "filmaker",
  "experto",
  "asistente",
] as const;

export type RecordingRole = (typeof RECORDING_ROLES)[number];

export const ROLE_LABEL: Record<RecordingRole, string> = {
  filmaker: "Filmaker",
  experto: "Experto",
  asistente: "Asistente",
};

export function isRecordingSessionStatus(v: string): v is RecordingSessionStatus {
  return (RECORDING_SESSION_STATUSES as readonly string[]).includes(v);
}

export function isRecordingRole(v: string): v is RecordingRole {
  return (RECORDING_ROLES as readonly string[]).includes(v);
}

export interface RecordingSessionRow {
  readonly id: string;
  readonly contentOwnerId: string;
  readonly name: string | null;
  readonly scheduledAt: string;
  readonly durationMinutes: number | null;
  readonly location: string | null;
  readonly materials: string | null;
  /** Link opcional al guion (típicamente Drive). 0187. */
  readonly scriptUrl: string | null;
  readonly notes: string | null;
  readonly status: RecordingSessionStatus;
  readonly completedAt: string | null;
}

export interface RecordingAssigneeRow {
  readonly recordingSessionId: string;
  readonly personId: string;
  readonly role: RecordingRole;
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
  /** Cuántas veces se publica cada `periodDays` días (0188). */
  readonly timesCount: number;
  readonly periodDays: number;
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

// ═══════════════════════════════════════════════════════════════════════════
// Content raws (0179) — Crudos: material SIN editar. Nace típicamente de una
// recording_session realizada, pero puede cargarse suelto (nullable).
// ═══════════════════════════════════════════════════════════════════════════

export interface ContentRawRow {
  readonly id: string;
  readonly contentOwnerId: string;
  readonly sourceRecordingSessionId: string | null;
  readonly name: string;
  readonly driveUrl: string;
  readonly notes: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Content edits (0180) — eventos de edición: "editar tal crudo". Reemplaza
// editor_person_id/edit_due_date que antes vivían en cada content_asset.
// Nacen EN COLA (`completedAt = null`); al marcarse realizados se cargan los
// content_assets de salida.
// ═══════════════════════════════════════════════════════════════════════════

export interface ContentEditRow {
  readonly id: string;
  readonly contentOwnerId: string;
  readonly sourceContentRawId: string | null;
  readonly title: string;
  readonly editorPersonId: string | null;
  readonly dueDate: string | null; // yyyy-mm-dd
  readonly completedAt: string | null;
  /** Formato esperado — alimenta el cálculo de capacidad diaria. 0191. */
  readonly targetFormat: MarketingFormat | null;
  readonly notes: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Content assets (0162, recortada en 0181) — archivo editado final, listo
// para stock. Nace siempre desde un content_edit marcado "realizada" (o
// huérfano, para importaciones — source_content_edit_id nullable).
// ═══════════════════════════════════════════════════════════════════════════

export interface ContentAssetRow {
  readonly id: string;
  readonly contentOwnerId: string;
  readonly sourceContentEditId: string | null;
  readonly sourceContentPieceId: string | null;
  readonly name: string;
  readonly format: MarketingFormat;
  readonly driveAssetUrl: string | null;
  readonly durationSeconds: number | null;
  /** Cuándo se terminó de editar (pasado). Setearlo lo manda al stock. */
  readonly editedAt: string | null;
  readonly notes: string | null;
}

/**
 * Estado de un asset frente al stock. El cálculo vive en
 * `@/lib/marketing/stock` (`computeAssetStockStates`) — acá sólo la
 * presentación, para que Stock, Edición y Subidas pinten lo mismo.
 */
export const ASSET_STOCK_STATE_LABEL = {
  en_cola: "En cola",
  disponible: "Disponible",
  reservado: "Reservado",
  utilizado: "Utilizado",
} as const;

export const ASSET_STOCK_STATE_TONE = {
  en_cola: "var(--kg-neutral-500)",
  disponible: "var(--kg-positive-500)",
  reservado: "var(--kg-warning-500)",
  utilizado: "var(--kg-neutral-500)",
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// Editor availability (0164) — bloques de disponibilidad por persona.
// ═══════════════════════════════════════════════════════════════════════════

export interface EditorAvailabilityRow {
  readonly id: string;
  readonly personId: string;
  readonly dateFrom: string; // yyyy-mm-dd
  readonly dateTo: string; // yyyy-mm-dd
  readonly available: boolean;
  readonly notes: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Editor weekly schedule (0189) — horario recurrente por día de semana.
// Complementa (no reemplaza) editor_availability: eso sigue siendo para
// excepciones puntuales (licencia, vacaciones); esto es la regla general.
// ═══════════════════════════════════════════════════════════════════════════

export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export type Weekday = (typeof WEEKDAYS)[number];

export const WEEKDAY_LABEL: Record<Weekday, string> = {
  1: "Lunes",
  2: "Martes",
  3: "Miércoles",
  4: "Jueves",
  5: "Viernes",
  6: "Sábado",
  7: "Domingo",
};

export const WEEKDAY_LABEL_SHORT: Record<Weekday, string> = {
  1: "Lun",
  2: "Mar",
  3: "Mié",
  4: "Jue",
  5: "Vie",
  6: "Sáb",
  7: "Dom",
};

export function isWeekday(v: number): v is Weekday {
  return (WEEKDAYS as readonly number[]).includes(v);
}

export interface EditorWeeklyScheduleRow {
  readonly id: string;
  readonly personId: string;
  readonly dayOfWeek: Weekday;
  readonly startTime: string; // HH:mm o HH:mm:ss
  readonly endTime: string;
  readonly notes: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Editor format capacity (0190) — máximo de piezas de un formato que un
// editor puede terminar en un día completo. Es un tope ALTERNATIVO por
// formato, no acumulable: "6 reels O 10 nuggets O 1 podcast", no los tres
// juntos. El cálculo de carga usa esto como 1/maxPerDay = fracción del día
// que consume una edición de ese formato.
// ═══════════════════════════════════════════════════════════════════════════

export interface EditorFormatCapacityRow {
  readonly id: string;
  readonly personId: string;
  readonly format: MarketingFormat;
  readonly maxPerDay: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Content uploads (0163) — subidas a plataformas.
// ═══════════════════════════════════════════════════════════════════════════

export const UPLOAD_STATUSES = [
  "planificada",
  "subida",
  "fallida",
  "cancelada",
] as const;

export type UploadStatus = (typeof UPLOAD_STATUSES)[number];

export const UPLOAD_STATUS_LABEL: Record<UploadStatus, string> = {
  planificada: "Planificada",
  subida: "Subida",
  fallida: "Fallida",
  cancelada: "Cancelada",
};

export const UPLOAD_STATUS_TONE: Record<UploadStatus, string> = {
  planificada: "var(--kg-neutral-500)",
  subida: "var(--kg-positive-500)",
  fallida: "var(--kg-negative-500)",
  cancelada: "var(--kg-neutral-500)",
};

export function isUploadStatus(v: string): v is UploadStatus {
  return (UPLOAD_STATUSES as readonly string[]).includes(v);
}

export interface ContentUploadRow {
  readonly id: string;
  readonly contentAssetId: string;
  readonly platform: MarketingPlatform;
  readonly scheduledFor: string; // yyyy-mm-dd
  readonly uploadedAt: string | null;
  readonly status: UploadStatus;
  readonly publicUrl: string | null;
  readonly notes: string | null;
  /** Quién dejó la subida seteada (líder del equipo). 0175. */
  readonly plannedByPersonId: string | null;
  /** Quién confirmó que la subió (community manager). 0175. */
  readonly uploadedByPersonId: string | null;
}
