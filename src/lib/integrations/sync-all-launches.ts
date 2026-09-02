import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { syncLaunch, type SyncProviderId } from "./sync";

/**
 * Sync incremental de los 3 providers (meta / ghl / sendflow) para todos los
 * launches abiertos (closed_at IS NULL).
 *
 * Extraído de /api/cron/sync-integrations en la consolidación de crons: el
 * dispatcher unificado (/api/cron/daily-jobs) llama esta función. El endpoint
 * original sigue existiendo para triggers manuales por curl/UI.
 *
 * Ejecución: secuencial por launch, paralela por provider dentro del launch.
 * Antes de invocar `syncLaunch` chequeamos que exista config del provider en el
 * launch — sin este skip el equipo comería 3 notifs "Falta config" por launch
 * por día.
 */

interface LaunchRow {
  id: string;
  project_id: string;
  integration_config: Record<string, unknown> | null;
}

export interface LaunchSyncResult {
  launchId: string;
  results: Array<{
    provider: SyncProviderId;
    status: string;
    rowsWritten: number;
    errorMessage: string | null;
  }>;
  skipped: SyncProviderId[];
}

export interface RunAllLaunchesSyncOutput {
  launchesConsidered: number;
  totals: Record<string, number>;
  results: LaunchSyncResult[];
}

export async function runAllLaunchesSync(
  service: SupabaseClient,
): Promise<RunAllLaunchesSyncOutput> {
  const launchesRes = await service
    .from("launches")
    .select("id, project_id, integration_config")
    .is("closed_at", null);

  if (launchesRes.error) {
    throw new Error(`No pude leer launches: ${launchesRes.error.message}`);
  }

  const launches = (launchesRes.data ?? []) as LaunchRow[];
  const results: LaunchSyncResult[] = [];

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

  return {
    launchesConsidered: launches.length,
    totals: summarize(results),
    results,
  };
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

function summarize(results: LaunchSyncResult[]): Record<string, number> {
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
