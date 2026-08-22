import { NextResponse } from "next/server";

import {
  retryPendingWebhooks,
  runDailyExpirations,
} from "@/lib/academia/expirations";
import { syncAllGhlTrackedCourses } from "@/lib/integrations/ghl-tag-sync";
import { runAllLaunchesSync } from "@/lib/integrations/sync-all-launches";
import { runAllEnabledNotionDatabases } from "@/lib/notion/sync-runner";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Cron dispatcher unificado (1 solo entry point para respetar el límite de
 * Vercel Hobby: 2 crons/día). Ejecuta en secuencia con try/catch independiente
 * por cada job — si uno falla, los otros siguen corriendo.
 *
 * Jobs ejecutados en orden:
 *   1) sync-integrations: meta/ghl/sendflow para launches abiertos
 *   2) notion-sync: incremental de todas las notion_databases enabled
 *   3) academia-daily: expiraciones + retry webhooks + tag sync GHL
 *
 * Los 3 endpoints originales (/api/cron/sync-integrations, /notion-sync,
 * /academia-daily) siguen existiendo para poder dispararse a mano por curl o
 * UI cuando hace falta, pero ya NO están en el schedule de Vercel.
 *
 * Auth: `Authorization: Bearer $CRON_SECRET`.
 * Schedule en vercel.json: "0 3 * * *" (03:00 UTC = 00:00 UTC-3).
 */

type JobResult =
  | { ok: true; durationMs: number; result: unknown }
  | { ok: false; durationMs: number; error: string };

async function runJob(
  name: string,
  fn: () => Promise<unknown>,
): Promise<JobResult> {
  const startedAt = Date.now();
  try {
    const result = await fn();
    return { ok: true, durationMs: Date.now() - startedAt, result };
  } catch (err) {
    return {
      ok: false,
      durationMs: Date.now() - startedAt,
      error:
        err instanceof Error ? `${name}: ${err.message}` : `${name}: threw non-Error`,
    };
  }
}

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

  const service = createServiceClient();
  const startedAt = new Date().toISOString();

  const syncIntegrations = await runJob("sync-integrations", () =>
    runAllLaunchesSync(service),
  );

  const notionSync = await runJob("notion-sync", () =>
    runAllEnabledNotionDatabases(service, { incremental: true }),
  );

  const expirations = await runJob("academia-expirations", () =>
    runDailyExpirations(service),
  );

  const webhookRetries = await runJob("academia-webhook-retries", () =>
    retryPendingWebhooks(service),
  );

  const tagSync = await runJob("academia-tag-sync", () =>
    syncAllGhlTrackedCourses(service),
  );

  const finishedAt = new Date().toISOString();

  return NextResponse.json({
    startedAt,
    finishedAt,
    jobs: {
      syncIntegrations,
      notionSync,
      expirations,
      webhookRetries,
      tagSync,
    },
  });
}
