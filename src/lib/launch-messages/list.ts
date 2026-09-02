import "server-only";

import { createServiceClient } from "@/lib/supabase/service";

/**
 * Reader per-day para la serie de mensajes WhatsApp/SMS entrantes del chart
 * diario (Fase B).
 *
 * Lee `launch_messages_daily`: 1 fila por (launch, date), ordenado asc por
 * fecha en la salida. La tabla ya no se sincroniza (el sync de mensajes se
 * removió en 2026-09-02) — el chart muestra lo histórico ya guardado.
 *
 * loose() workaround: la tabla `launch_messages_daily` se agregó en migration
 * 0035 — el Database type generado puede no conocerla hasta el próximo regen
 * del generador. Mismo patrón que `listCommunityMetricsForLaunch`.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type LooseClient = { from: (name: string) => any };
function loose(svc: unknown): LooseClient {
  return svc as LooseClient;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface MessagesDailyEntry {
  /** YYYY-MM-DD */
  date: string;
  /** Conteo de mensajes inbound WhatsApp/SMS-family ese día. */
  inboundCount: number;
}

interface RawRow {
  date: string | null;
  inbound_count: number | string | null;
}

export async function listMessagesDailyForLaunch(
  launchId: string,
): Promise<MessagesDailyEntry[]> {
  const service = createServiceClient();
  const { data, error } = await loose(service)
    .from("launch_messages_daily")
    .select("date, inbound_count")
    .eq("launch_id", launchId)
    .order("date", { ascending: true });

  if (error || !data) return [];

  const rows = data as RawRow[];
  const out: MessagesDailyEntry[] = [];
  for (const row of rows) {
    if (typeof row.date !== "string") continue;
    out.push({
      date: row.date,
      inboundCount: toInt(row.inbound_count),
    });
  }
  return out;
}

function toInt(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string") {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}
