import { NextResponse } from "next/server";

import { runAllEnabledNotionDatabases } from "@/lib/notion/sync-runner";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Cron que sincroniza incrementalmente todas las notion_databases enabled
 * (cuyo workspace también esté enabled). El schedule vive en `vercel.json`
 * (cada 15 min).
 *
 * Auth: mismo esquema que `/api/cron/sync-integrations` — Vercel Cron inyecta
 * `Authorization: Bearer $CRON_SECRET` en cada invocación; rebotamos 401 sin
 * ese header. Compartimos el mismo `CRON_SECRET` con el otro cron.
 *
 * Sync incremental: el runner calcula el anchor por DB desde
 * `notion_sync_log` (MAX(started_at) de logs ok/partial) y aplica un filter
 * `last_edited_time on_or_after {anchor}` a la query de Notion. Ver la
 * limitación de comentarios documentada en `sync-runner.ts`.
 */

export async function GET(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET no configurado" },
      { status: 500 },
    );
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const startedAt = new Date().toISOString();

  const result = await runAllEnabledNotionDatabases(supabase, {
    incremental: true,
  });

  const finishedAt = new Date().toISOString();

  return NextResponse.json({
    startedAt,
    finishedAt,
    ...result,
  });
}
