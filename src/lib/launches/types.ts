import type { Database } from "@/lib/types/database";

/**
 * One launch row, exactly as it lives in the DB. Single source of truth for
 * the launches table's TypeScript shape — derived from the generated types so
 * a schema change picked up by `supabase gen types` propagates automatically.
 */
export type LaunchRow = Database["public"]["Tables"]["launches"]["Row"];

export type LaunchStatus = "Activo" | "Escalando" | "Finalizado" | "Evergreen";
export type LaunchType = "En Vivo" | "Automatizado" | "Replay";
