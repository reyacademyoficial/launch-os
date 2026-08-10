import { NextResponse } from "next/server";

import { syncLaunch, type SyncProviderId } from "@/lib/integrations/sync";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Cron diario que sincroniza los 3 providers (meta / ghl / sendflow) para todos
 * los launches abiertos (closed_at IS NULL). ghl_messages queda afuera — es
 * pesado y sigue disparándose a mano desde la UI.
 *
 * Schedule en vercel.json: "0 11 * * *" (11:00 UTC = 08:00 UTC-3).
 *
 * Auth: Vercel Cron inyecta `Authorization: Bearer $CRON_SECRET` en cada
 * invocación. Rechazamos cualquier request sin ese header — esto también evita
 * que alguien dispare el endpoint desde afuera.
 *
 * Ejecución: secuencial por launch, paralela por provider dentro del launch.
 * Antes de invocar chequeamos que exista config del provider en el launch,
 * porque `syncLaunch` en `config_missing` inserta run + notif — sin este skip
 * el equipo comería 3 notifs "Falta config" por launch cada día.
 */

interface LaunchRow {
  id: string;
  project_id: string;
  integration_config: Record<string, unknown> | null;
}

interface LaunchResult {
  launchId: string;
  results: Array<{
    provider: SyncProviderId;
    status: string;
    rowsWritten: number;
    errorMessage: string | null;
  }>;
  skipped: SyncProviderId[];
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

  const launchesRes = await service
    .from("launches")
    .select("id, project_id, integration_config")
    .is("closed_at", null);

  if (launchesRes.error) {
    return NextResponse.json(
      { error: `No pude leer launches: ${launchesRes.error.message}` },
      { status: 500 },
    );
  }

  const launches = (launchesRes.data ?? []) as LaunchRow[];
  const startedAt = new Date().toISOString();
  const results: LaunchResult[] = [];

  for (const launch of launches) {
    const providers = pickConfiguredProviders(launch.integration_config);
    const skipped: SyncProviderId[] = (
      ["meta", "ghl", "sendflow"] as SyncProviderId[]
    ).filter((p) => !providers.includes(p));

    if (providers.length === 0) {
      results.push({ launchId: launch.id, results: [], skipped });
      continue;
    }

    const settled = await Promise.all(
      providers.map((provider) =>
        syncLaunch({ launchId: launch.id, provider, triggeredBy: null }).then(
          (r) => ({
            provider,
            status: r.status,
            rowsWritten: r.rowsWritten,
            errorMessage: r.errorMessage,
          }),
          (err: unknown) => ({
            provider,
            status: "error",
            rowsWritten: 0,
            errorMessage:
              err instanceof Error ? err.message : "sync threw non-Error",
          }),
        ),
      ),
    );

    results.push({ launchId: launch.id, results: settled, skipped });
  }

  const finishedAt = new Date().toISOString();
  const totals = summarize(results);

  return NextResponse.json({
    startedAt,
    finishedAt,
    launchesConsidered: launches.length,
    totals,
    results,
  });
}

/**
 * Devuelve la lista de providers (meta/ghl/sendflow) que tienen config mínima
 * en el launch. El "mínimo" replica lo que `syncLaunch` chequea al arrancar:
 *  - meta: al menos una entry con ad_account_id y ≥1 campaign (o shape legacy)
 *  - ghl: location_id no vacío
 *  - sendflow: al menos un release_id
 * Si el chequeo pasa acá pero `syncLaunch` termina en config_missing (ej. falta
 * token), eso sí genera notif — es la señal correcta para que alguien vaya a
 * pegar el token que falta.
 */
function pickConfiguredProviders(
  configBlob: Record<string, unknown> | null,
): SyncProviderId[] {
  if (!configBlob) return [];
  const providers: SyncProviderId[] = [];

  if (hasMetaConfig(configBlob.meta)) providers.push("meta");
  if (hasGhlConfig(configBlob.ghl)) providers.push("ghl");
  if (hasSendflowConfig(configBlob.sendflow)) providers.push("sendflow");

  return providers;
}

function hasMetaConfig(raw: unknown): boolean {
  if (raw === null || typeof raw !== "object") return false;
  const rec = raw as Record<string, unknown>;
  if (Array.isArray(rec.ad_accounts)) {
    return rec.ad_accounts.some((entry) => isValidAdAccountEntry(entry));
  }
  return isValidAdAccountEntry(rec);
}

function isValidAdAccountEntry(entry: unknown): boolean {
  if (entry === null || typeof entry !== "object") return false;
  const rec = entry as Record<string, unknown>;
  const acct = rec.ad_account_id;
  const campaigns = rec.campaign_ids;
  if (typeof acct !== "string" || acct.length === 0) return false;
  if (!Array.isArray(campaigns)) return false;
  return campaigns.some((c) => typeof c === "string" && c.length > 0);
}

function hasGhlConfig(raw: unknown): boolean {
  if (raw === null || typeof raw !== "object") return false;
  const rec = raw as Record<string, unknown>;
  return typeof rec.location_id === "string" && rec.location_id.trim() !== "";
}

function hasSendflowConfig(raw: unknown): boolean {
  if (raw === null || typeof raw !== "object") return false;
  const rec = raw as Record<string, unknown>;
  if (!Array.isArray(rec.release_ids)) return false;
  return rec.release_ids.some((id) => typeof id === "string" && id.length > 0);
}

function summarize(results: LaunchResult[]): Record<string, number> {
  const totals: Record<string, number> = {
    launches_with_config: 0,
    provider_runs: 0,
    success: 0,
    partial: 0,
    error: 0,
    token_invalid: 0,
    rate_limited: 0,
    config_missing: 0,
  };
  for (const launch of results) {
    if (launch.results.length > 0) totals.launches_with_config! += 1;
    for (const r of launch.results) {
      totals.provider_runs! += 1;
      totals[r.status] = (totals[r.status] ?? 0) + 1;
    }
  }
  return totals;
}
