import { NextResponse } from "next/server";

import { runAllLaunchesSync } from "@/lib/integrations/sync-all-launches";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Endpoint manual/legacy de sync de integraciones (meta/ghl/sendflow) para
 * todos los launches abiertos. Post consolidación de crons, este endpoint ya
 * NO está en el schedule de Vercel — el dispatcher unificado
 * (`/api/cron/daily-jobs`) llama a `runAllLaunchesSync` directamente. Este
 * route sigue existiendo para poder dispararlo a mano por curl o UI cuando
 * hace falta.
 *
 * Auth: `Authorization: Bearer $CRON_SECRET`.
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

  try {
    const result = await runAllLaunchesSync(service);
    const finishedAt = new Date().toISOString();
    return NextResponse.json({ startedAt, finishedAt, ...result });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "sync-all-launches threw",
      },
      { status: 500 },
    );
  }
}
