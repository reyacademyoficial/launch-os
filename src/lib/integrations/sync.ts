import "server-only";

import { createServiceClient } from "@/lib/supabase/service";

import { fetchMetaInsights, type MetaInsightDay, type MetaSyncResult } from "./meta";
import { runGhlSync, type GhlRunSummary } from "./sync-ghl";

/**
 * Orchestrator del sync. Una sola función pública `syncLaunch` que el Server
 * Action invoca después de pasar el gate de permisos.
 *
 * Diseño:
 *  - Corre TODO con el service-role client. Es la única manera de leer
 *    `launch_secrets` (RLS sin policies) y de escribir `launch_daily_ads` +
 *    `integration_runs` (RLS sin policies de write para `authenticated`).
 *  - 1 sync = 1 fila en `integration_runs`. El status final se actualiza al
 *    cerrar; la fila `running` queda visible mientras corre (la UI puede
 *    mostrar spinner).
 *  - Upsert en `launch_daily_ads` por (launch_id, date, provider) → corrió
 *    el sync N veces deja el mismo resultado, no duplica.
 *  - Días fuera de [date_start, date_end] del launch se descartan
 *    defensivamente. Meta no debería devolverlos (le pedimos el rango), pero
 *    si acaso.
 *  - Si el launch está cerrado o falta config → no llama a Meta, registra
 *    `config_missing` y termina.
 */

export type SyncProviderId = "meta" | "ghl";

export interface SyncLaunchInput {
  launchId: string;
  provider: SyncProviderId;
  triggeredBy: string | null;
}

export interface SyncLaunchResult {
  runId: string;
  status:
    | "success"
    | "error"
    | "token_invalid"
    | "rate_limited"
    | "config_missing";
  rowsWritten: number;
  errorMessage: string | null;
}

interface LaunchSnapshot {
  id: string;
  project_id: string;
  date_start: string | null;
  date_end: string | null;
  closed_at: string | null;
  integration_config: Record<string, unknown>;
}

interface MetaProviderConfig {
  ad_account_id?: string;
  campaign_ids?: string[];
}

interface GhlProviderConfig {
  /**
   * Location ID (subaccount) de GHL. Cambia por launch porque cada cliente
   * tiene su propio location aunque compartan PIT del business.
   */
  location_id?: string;
  /**
   * Default country code para normalizar los teléfonos GHL antes del match.
   * Si no se setea, fallback a "AR" para no bloquear el sync. Cuando exista
   * config por project, este default se va al project.
   */
  default_country?: string;
}

/**
 * Orquesta una corrida completa para `(launchId, provider)`. Idempotente —
 * llamarla 2 veces seguidas devuelve el mismo estado final.
 */
export async function syncLaunch(
  input: SyncLaunchInput,
): Promise<SyncLaunchResult> {
  const service = createServiceClient();

  // 1) Cargar launch + verificar ventana / cerrado
  const launchRes = await service
    .from("launches")
    .select(
      "id, project_id, date_start, date_end, closed_at, integration_config",
    )
    .eq("id", input.launchId)
    .maybeSingle();

  const launch = launchRes.data as LaunchSnapshot | null;
  if (!launch) {
    // No insertamos run porque no podemos referenciar un launch que no existe
    // (FK). Devolvemos config_missing virtual al caller para que muestre error.
    return {
      runId: "",
      status: "config_missing",
      rowsWritten: 0,
      errorMessage: "El lanzamiento no existe",
    };
  }
  if (launch.closed_at !== null) {
    return await recordTerminalRun(
      service,
      input,
      launch,
      "config_missing",
      "El lanzamiento está cerrado. Reabrilo para sincronizar.",
      { cause: "launch_closed" },
    );
  }
  if (!launch.date_start || !launch.date_end) {
    return await recordTerminalRun(
      service,
      input,
      launch,
      "config_missing",
      "El lanzamiento no tiene fecha definida. Completá launch_date.",
      { cause: "missing_window" },
    );
  }

  // 2a) GHL toma su propia rama — modelo y errores son distintos a Meta.
  //     Lee config + secret + ejecuta match adentro y devuelve directo.
  if (input.provider === "ghl") {
    return await runGhlBranch({
      service,
      input,
      launchId: launch.id,
      projectId: launch.project_id,
      dateStart: launch.date_start,
      dateEnd: launch.date_end,
      integrationConfig: launch.integration_config,
    });
  }

  // 2b) Meta: cargar config + secret
  const providerConfig = readProviderConfig(launch.integration_config, input.provider);
  if (!providerConfig.ad_account_id) {
    return await recordTerminalRun(
      service,
      input,
      launch,
      "config_missing",
      "Falta el ad_account_id en la config del launch.",
      { cause: "missing_ad_account_id" },
    );
  }
  if (
    !Array.isArray(providerConfig.campaign_ids) ||
    providerConfig.campaign_ids.length === 0
  ) {
    return await recordTerminalRun(
      service,
      input,
      launch,
      "config_missing",
      "Hay que asociar al menos una campaña al lanzamiento antes de sincronizar.",
      { cause: "missing_campaigns" },
    );
  }

  const secretRes = await service
    .from("launch_secrets")
    .select("secret")
    .eq("launch_id", launch.id)
    .eq("provider", input.provider)
    .maybeSingle();
  const token = (secretRes.data as { secret: string } | null)?.secret ?? null;
  if (!token) {
    return await recordTerminalRun(
      service,
      input,
      launch,
      "config_missing",
      "Falta el access token del provider. Pegalo en la sección de integraciones del launch.",
      { cause: "missing_token" },
    );
  }

  // 3) Insertar run en estado running con la ventana
  const runPayload = {
    launch_id: launch.id,
    provider: input.provider,
    triggered_by: input.triggeredBy,
    status: "running",
    window_start: launch.date_start,
    window_end: launch.date_end,
  } as never;

  const runInsert = await service
    .from("integration_runs")
    .insert(runPayload)
    .select("id")
    .maybeSingle();
  const runId = (runInsert.data as { id: string } | null)?.id;
  if (!runId) {
    return {
      runId: "",
      status: "error",
      rowsWritten: 0,
      errorMessage:
        runInsert.error?.message ?? "No pude insertar el integration_run inicial",
    };
  }

  // 4) Llamar al adapter Meta — la rama GHL ya retornó antes (2a).
  const result: MetaSyncResult = await fetchMetaInsights({
    token,
    adAccountId: providerConfig.ad_account_id,
    campaignIds: providerConfig.campaign_ids,
    since: launch.date_start,
    until: launch.date_end,
  });

  // 5) Manejar el resultado
  if (!result.ok) {
    const detail = {
      ...result.detail,
      message: result.message,
      retryAfterSeconds: result.retryAfterSeconds ?? null,
    };
    return await finalizeRun(service, runId, result.kind, 0, detail);
  }

  // 6) Filtrar a la ventana del launch y upsert
  const startDate = launch.date_start;
  const endDate = launch.date_end;
  const inWindow = result.rows.filter(
    (r) => r.date >= startDate && r.date <= endDate,
  );

  if (inWindow.length === 0) {
    return await finalizeRun(service, runId, "success", 0, null);
  }

  const rowsToWrite = inWindow.map((day) => buildAdsRow(launch.id, input.provider, day));
  const upsert = await service
    .from("launch_daily_ads")
    .upsert(rowsToWrite as never, { onConflict: "launch_id,date,provider" });

  if (upsert.error) {
    return await finalizeRun(service, runId, "error", 0, {
      cause: "upsert_failed",
      message: upsert.error.message,
    });
  }

  return await finalizeRun(service, runId, "success", inWindow.length, null);
}

// ─── helpers internos ───────────────────────────────────────────────────────

function readProviderConfig(
  configBlob: unknown,
  provider: SyncProviderId,
): MetaProviderConfig {
  if (configBlob === null || typeof configBlob !== "object") return {};
  const cfg = (configBlob as Record<string, unknown>)[provider];
  if (cfg === null || typeof cfg !== "object") return {};
  const record = cfg as Record<string, unknown>;
  const acct = record.ad_account_id;
  const campaigns = record.campaign_ids;
  return {
    ad_account_id: typeof acct === "string" ? acct : undefined,
    campaign_ids: Array.isArray(campaigns)
      ? campaigns.filter((c): c is string => typeof c === "string")
      : undefined,
  };
}

function readGhlConfig(configBlob: unknown): GhlProviderConfig {
  if (configBlob === null || typeof configBlob !== "object") return {};
  const cfg = (configBlob as Record<string, unknown>).ghl;
  if (cfg === null || typeof cfg !== "object") return {};
  const record = cfg as Record<string, unknown>;
  return {
    location_id: typeof record.location_id === "string" ? record.location_id : undefined,
    default_country:
      typeof record.default_country === "string" ? record.default_country : undefined,
  };
}

/**
 * Bifurcación del orchestrator para GHL. Levanta config + secret, crea el
 * `integration_run` y delega el grueso del trabajo a `runGhlSync` (match +
 * INSERT/UPDATE de leads). Devuelve el SyncLaunchResult coherente con la
 * rama Meta para que el caller no tenga que ramificar.
 */
async function runGhlBranch(args: {
  service: ServiceClient;
  input: SyncLaunchInput;
  launchId: string;
  projectId: string;
  dateStart: string;
  dateEnd: string;
  integrationConfig: Record<string, unknown>;
}): Promise<SyncLaunchResult> {
  const { service, input } = args;
  const launchSnapshot: LaunchSnapshot = {
    id: args.launchId,
    project_id: args.projectId,
    date_start: args.dateStart,
    date_end: args.dateEnd,
    closed_at: null, // ya validado arriba
    integration_config: args.integrationConfig,
  };

  const cfg = readGhlConfig(args.integrationConfig);
  if (!cfg.location_id) {
    return await recordTerminalRun(
      service,
      input,
      launchSnapshot,
      "config_missing",
      "Falta el location_id en la config del launch (Subaccount ID de GHL).",
      { cause: "missing_location_id" },
    );
  }

  const secretRes = await service
    .from("launch_secrets")
    .select("secret")
    .eq("launch_id", args.launchId)
    .eq("provider", "ghl")
    .maybeSingle();
  const token = (secretRes.data as { secret: string } | null)?.secret ?? null;
  if (!token) {
    return await recordTerminalRun(
      service,
      input,
      launchSnapshot,
      "config_missing",
      "Falta el Private Integration Token de GHL. Pegalo en la sección de integraciones del launch.",
      { cause: "missing_token" },
    );
  }

  const runPayload = {
    launch_id: args.launchId,
    provider: "ghl",
    triggered_by: input.triggeredBy,
    status: "running",
    window_start: args.dateStart,
    window_end: args.dateEnd,
  } as never;

  const runInsert = await service
    .from("integration_runs")
    .insert(runPayload)
    .select("id")
    .maybeSingle();
  const runId = (runInsert.data as { id: string } | null)?.id;
  if (!runId) {
    return {
      runId: "",
      status: "error",
      rowsWritten: 0,
      errorMessage:
        runInsert.error?.message ?? "No pude insertar el integration_run inicial",
    };
  }

  const summary: GhlRunSummary = await runGhlSync({
    service,
    token,
    locationId: cfg.location_id,
    defaultCountry: cfg.default_country ?? "AR",
    projectId: args.projectId,
    launchId: args.launchId,
    since: args.dateStart,
    until: args.dateEnd,
  });

  if (!summary.ok) {
    return await finalizeRun(service, runId, summary.kind, 0, {
      ...summary.detail,
      message: summary.message,
      retryAfterSeconds: summary.retryAfterSeconds ?? null,
    });
  }

  const totalWritten =
    summary.appointments.created +
    summary.appointments.updated +
    summary.conversations.created +
    summary.conversations.updated;

  return await finalizeRun(service, runId, "success", totalWritten, {
    cause: "ghl_summary",
    appointments: summary.appointments,
    conversations: summary.conversations,
  });
}

function buildAdsRow(
  launchId: string,
  provider: SyncProviderId,
  day: MetaInsightDay,
) {
  return {
    launch_id: launchId,
    date: day.date,
    provider,
    spend: day.spend,
    impressions: day.impressions,
    clicks: day.clicks,
    leads: day.leads,
    raw: day.raw,
    synced_at: new Date().toISOString(),
  };
}

type ServiceClient = ReturnType<typeof createServiceClient>;

/**
 * Inserta un run ya cerrado con el status terminal indicado. Útil para los
 * casos pre-adapter (config_missing) donde queremos dejar registro pero
 * sin pasar por el flow normal de "running → finished".
 */
async function recordTerminalRun(
  service: ServiceClient,
  input: SyncLaunchInput,
  launch: LaunchSnapshot,
  status: SyncLaunchResult["status"],
  message: string,
  detail: Record<string, unknown>,
): Promise<SyncLaunchResult> {
  const payload = {
    launch_id: launch.id,
    provider: input.provider,
    triggered_by: input.triggeredBy,
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    status,
    rows_written: 0,
    error_detail: { ...detail, message },
    window_start: launch.date_start,
    window_end: launch.date_end,
  } as never;

  const inserted = await service
    .from("integration_runs")
    .insert(payload)
    .select("id")
    .maybeSingle();
  const runId = (inserted.data as { id: string } | null)?.id ?? "";

  return {
    runId,
    status,
    rowsWritten: 0,
    errorMessage: message,
  };
}

/**
 * Cierra un run insertado en estado `running`. Actualiza finished_at + status
 * + rows_written + error_detail en una sola UPDATE.
 */
async function finalizeRun(
  service: ServiceClient,
  runId: string,
  status: SyncLaunchResult["status"],
  rowsWritten: number,
  errorDetail: Record<string, unknown> | null,
): Promise<SyncLaunchResult> {
  const payload = {
    finished_at: new Date().toISOString(),
    status,
    rows_written: rowsWritten,
    error_detail: errorDetail,
  } as never;

  await service.from("integration_runs").update(payload).eq("id", runId);

  return {
    runId,
    status,
    rowsWritten,
    errorMessage:
      errorDetail && typeof errorDetail.message === "string"
        ? (errorDetail.message as string)
        : null,
  };
}
