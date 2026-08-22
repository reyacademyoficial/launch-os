import { NextResponse } from "next/server";

import {
  retryPendingWebhooks,
  runDailyExpirations,
} from "@/lib/academia/expirations";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Cron diario de Academia (Fase D unificada). 1 solo cron para respetar el
 * límite de Vercel Hobby (2 crons/día en total). Ejecuta en secuencia:
 *
 *   1) Barrido de expiraciones:
 *      - Marca 'expired' los enrollments con access_expires_at < today.
 *      - Inserta enrollment_expiration_events y dispara el webhook GHL
 *        configurado en el course (skip si no hay URL).
 *      - Reintenta events 'failed' con retries<3.
 *
 *   2) Tag sync GHL (Máquina del Éxito):
 *      - Invoca `syncAllGhlTrackedCourses` de Fase C (import lazy con try/catch
 *      — si el agente C todavía no aterrizó el módulo, saltea con log).
 *
 * Auth: mismo esquema que los otros crons — `Authorization: Bearer $CRON_SECRET`.
 * Vercel Cron lo inyecta automáticamente.
 *
 * Schedule en vercel.json: "0 3 * * *" (03:00 UTC = 00:00 UTC-3).
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

  const service = createServiceClient();
  const startedAt = new Date().toISOString();

  // ──────────────────────────────────────────────────────────────
  // Step 1 · expiraciones + retry de failed
  // ──────────────────────────────────────────────────────────────
  const expirations = await runDailyExpirations(service);
  const retries = await retryPendingWebhooks(service);

  // ──────────────────────────────────────────────────────────────
  // Step 2 · tag sync GHL (Fase C). Import lazy con try/catch por si el
  // agente C todavía no publicó el módulo.
  // ──────────────────────────────────────────────────────────────
  let tagSync:
    | { ok: true; result: unknown }
    | { ok: false; reason: string } = {
    ok: false,
    reason: "not_attempted",
  };

  try {
    const mod: unknown = await import("@/lib/integrations/ghl-tag-sync").catch(
      () => null,
    );
    if (
      mod &&
      typeof (mod as { syncAllGhlTrackedCourses?: unknown })
        .syncAllGhlTrackedCourses === "function"
    ) {
      const fn = (mod as {
        syncAllGhlTrackedCourses: (client?: unknown) => Promise<unknown>;
      }).syncAllGhlTrackedCourses;
      const result = await fn(service);
      tagSync = { ok: true, result };
    } else {
      tagSync = {
        ok: false,
        reason: "ghl-tag-sync module not available (Fase C pending)",
      };
    }
  } catch (err) {
    tagSync = {
      ok: false,
      reason:
        err instanceof Error
          ? `syncAllGhlTrackedCourses threw: ${err.message}`
          : "syncAllGhlTrackedCourses threw non-Error",
    };
  }

  const finishedAt = new Date().toISOString();

  return NextResponse.json({
    startedAt,
    finishedAt,
    expirations,
    retries,
    tagSync,
  });
}
