import "server-only";

import { evaluateAlertsForLaunch } from "@/lib/alerts/evaluate";
import { tryComputeLaunchCalendar } from "@/lib/launches/calendar";
import { createServiceClient } from "@/lib/supabase/service";

import { fetchMetaInsights, type MetaInsightDay } from "./meta";
import {
  fetchSendflowAnalytics,
  type SendflowAnalyticsSuccess,
} from "./sendflow";
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

export type SyncProviderId = "meta" | "ghl" | "sendflow";

// Cast laxo para llamar a `expire_stale_integration_runs` (RPC fuera del
// Database type generado) y para queries contra columnas nuevas que el
// generador todavía no conoce (ej. `stage` agregado por 0020). Mismo
// workaround que usa sync-ghl.ts.
/* eslint-disable @typescript-eslint/no-explicit-any */
type LooseClient = {
  rpc: (name: string, args?: Record<string, unknown>) => any;
  from: (name: string) => any;
};
/* eslint-enable @typescript-eslint/no-explicit-any */
function loose(svc: unknown): LooseClient {
  return svc as LooseClient;
}

export interface SyncLaunchInput {
  launchId: string;
  provider: SyncProviderId;
  triggeredBy: string | null;
}

export interface SyncLaunchResult {
  runId: string;
  status:
    | "success"
    | "partial"
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

/**
 * Config de Meta para un launch. Soporta múltiples ad accounts dentro del
 * MISMO Business Manager (un solo token los cubre a todos).
 *
 * Shape vivo en `launches.integration_config.meta`:
 *   {
 *     "ad_accounts": [
 *       { "ad_account_id": "act_111", "campaign_ids": ["c1", "c2"] },
 *       { "ad_account_id": "act_222", "campaign_ids": ["c3"] }
 *     ]
 *   }
 *
 * Shape legacy (pre multi-account): { ad_account_id, campaign_ids }.
 * `readProviderConfig` lo normaliza al shape nuevo (array de 1) sin romper.
 */
interface MetaAdAccountEntry {
  ad_account_id: string;
  campaign_ids: string[];
}
interface MetaProviderConfig {
  ad_accounts: MetaAdAccountEntry[];
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
 * Config de SendFlow para un launch.
 *
 * Shape vivo en `launches.integration_config.sendflow`:
 *   { "release_ids": ["abc123", "def456", ...] }
 *
 * Un launch puede tener N comunidades (releases). El sync llama
 * /releases/{id}/analytics por cada una y suma `add/remove/clicks` acotados
 * a la ventana [date_start, date_end] del launch. Mínimo 1 release.
 */
interface SendflowProviderConfig {
  release_ids: string[];
}

/**
 * Orquesta una corrida completa para `(launchId, provider)`. Idempotente —
 * llamarla 2 veces seguidas devuelve el mismo estado final.
 */
export async function syncLaunch(
  input: SyncLaunchInput,
): Promise<SyncLaunchResult> {
  const service = createServiceClient();

  // 0) Watchdog: marcar como 'error' cualquier run colgado en 'running' más
  // de 15 min. Si el sync anterior se cortó (timeout, pestaña cerrada), su
  // fila quedó atascada y bloquea el botón. Limpiamos antes de empezar.
  // No fallamos si el RPC falla — es un nice-to-have, no crítico.
  await loose(service).rpc("expire_stale_integration_runs", {
    p_threshold: "15 minutes",
  });

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

  // 2a.bis) SendFlow: provider read-only de métricas de comunidad. Modelo
  //         (entered/removed/clicks por ventana) y errores (sin rate-limit
  //         documentado) son distintos a Meta, va por rama propia.
  if (input.provider === "sendflow") {
    return await runSendflowBranch({
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
  if (providerConfig.ad_accounts.length === 0) {
    return await recordTerminalRun(
      service,
      input,
      launch,
      "config_missing",
      "Configurá al menos una cuenta publicitaria con al menos una campaña antes de sincronizar.",
      { cause: "missing_ad_accounts" },
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

  // 4) Llamar al adapter Meta por cada ad_account (mismo token cubre a todos
  // dentro del mismo BM). Acumulamos todos los rows; `mergeInsightsByDate`
  // más abajo se encarga de sumar entre cuentas Y entre campañas por fecha.
  // En paralelo: las 3 cuentas y sus 3 campañas son requests independientes,
  // no hay razón para serializar. Si una falla con token_invalid/rate_limited
  // abortamos completo (no tiene sentido seguir con las otras).
  const accountResults = await Promise.all(
    providerConfig.ad_accounts.map((entry) =>
      fetchMetaInsights({
        token,
        adAccountId: entry.ad_account_id,
        campaignIds: entry.campaign_ids,
        since: launch.date_start!,
        until: launch.date_end!,
      }),
    ),
  );

  // 5) Si alguna falló, propagamos la primera falla con detalle de qué cuenta.
  const allRows: MetaInsightDay[] = [];
  for (let i = 0; i < accountResults.length; i++) {
    const r = accountResults[i]!;
    if (!r.ok) {
      const accountId = providerConfig.ad_accounts[i]?.ad_account_id ?? "?";
      const detail = {
        ...r.detail,
        message: r.message,
        retryAfterSeconds: r.retryAfterSeconds ?? null,
        failed_ad_account_id: accountId,
      };
      return await finalizeRun(service, runId, r.kind, 0, detail);
    }
    allRows.push(...r.rows);
  }

  // 6) Filtrar a la ventana del launch y agrupar por fecha.
  // `mergeInsightsByDate` suma todas las filas con el mismo `date` —
  // funciona tanto para "N campañas en una cuenta" como para "M cuentas
  // con sus campañas".
  const startDate = launch.date_start;
  const endDate = launch.date_end;
  const inWindow = allRows.filter(
    (r) => r.date >= startDate && r.date <= endDate,
  );

  if (inWindow.length === 0) {
    return await finalizeRun(service, runId, "success", 0, null);
  }

  const mergedByDate = mergeInsightsByDate(inWindow);
  const rowsToWrite = mergedByDate.map((day) =>
    buildAdsRow(launch.id, input.provider, day),
  );
  const upsert = await service
    .from("launch_daily_ads")
    .upsert(rowsToWrite as never, { onConflict: "launch_id,date,provider" });

  if (upsert.error) {
    return await finalizeRun(service, runId, "error", 0, {
      cause: "upsert_failed",
      message: upsert.error.message,
    });
  }

  // rows_written = filas escritas en launch_daily_ads, que después del merge
  // es 1 por (launch, date, provider) — usamos mergedByDate.length, no
  // inWindow.length (que cuenta las filas antes de agrupar por cuenta+campaña).
  return await finalizeRun(service, runId, "success", mergedByDate.length, null);
}

// ─── helpers internos ───────────────────────────────────────────────────────

/**
 * Lee la config del provider de ads y la normaliza al shape multi-account.
 *
 * Acepta dos formatos:
 *  1) `{ ad_accounts: [{ad_account_id, campaign_ids}, ...] }` (nuevo)
 *  2) `{ ad_account_id, campaign_ids }` (legacy, se convierte a array de 1)
 *
 * Filtra defensivamente: solo entradas con `ad_account_id` string y al menos
 * un `campaign_id` string sobreviven. Lo que queda inválido se descarta
 * silenciosamente — el caller chequea `ad_accounts.length === 0` para
 * decidir si reportar `config_missing`.
 */
function readProviderConfig(
  configBlob: unknown,
  provider: SyncProviderId,
): MetaProviderConfig {
  if (configBlob === null || typeof configBlob !== "object") {
    return { ad_accounts: [] };
  }
  const cfg = (configBlob as Record<string, unknown>)[provider];
  if (cfg === null || typeof cfg !== "object") return { ad_accounts: [] };
  const record = cfg as Record<string, unknown>;

  // Shape nuevo: array de entries.
  if (Array.isArray(record.ad_accounts)) {
    const entries: MetaAdAccountEntry[] = [];
    for (const item of record.ad_accounts) {
      const entry = sanitizeEntry(item);
      if (entry) entries.push(entry);
    }
    return { ad_accounts: entries };
  }

  // Shape legacy: ad_account_id + campaign_ids sueltos.
  const legacy = sanitizeEntry(record);
  return { ad_accounts: legacy ? [legacy] : [] };
}

function sanitizeEntry(item: unknown): MetaAdAccountEntry | null {
  if (item === null || typeof item !== "object") return null;
  const rec = item as Record<string, unknown>;
  const acct = rec.ad_account_id;
  const campaigns = rec.campaign_ids;
  if (typeof acct !== "string" || acct.length === 0) return null;
  if (!Array.isArray(campaigns)) return null;
  const filtered = campaigns.filter(
    (c): c is string => typeof c === "string" && c.length > 0,
  );
  if (filtered.length === 0) return null;
  return { ad_account_id: acct, campaign_ids: filtered };
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
 * Lee la config de SendFlow del blob. Filtra defensivamente — solo strings
 * no vacíos sobreviven. El caller chequea `release_ids.length === 0` para
 * decidir `config_missing`.
 */
function readSendflowConfig(configBlob: unknown): SendflowProviderConfig {
  if (configBlob === null || typeof configBlob !== "object") {
    return { release_ids: [] };
  }
  const cfg = (configBlob as Record<string, unknown>).sendflow;
  if (cfg === null || typeof cfg !== "object") return { release_ids: [] };
  const record = cfg as Record<string, unknown>;
  if (!Array.isArray(record.release_ids)) return { release_ids: [] };
  const ids = record.release_ids.filter(
    (x): x is string => typeof x === "string" && x.length > 0,
  );
  return { release_ids: ids };
}

/**
 * Bifurcación del orchestrator para GHL. Una corrida = UNA stage. Cada stage
 * se persiste con su propio integration_run (incluye columna `stage`), lleva
 * su propio `lastSuccessAt` incremental y vive dentro del timeout del Server
 * Action. El usuario hace 3 clicks para cubrir las 3 stages (o 1 click si ya
 * sincronizó las otras y solo quiere refrescar una).
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

  // Una sola fila en integration_runs con stage='all'. Las stages individuales
  // ya no se usan — el sync corre todo en una corrida. El valor 'all' permite
  // distinguir runs nuevos de los runs viejos (que tenían stage='appointments'/
  // 'conversations'/'contacts' o NULL).
  const runPayload = {
    launch_id: args.launchId,
    provider: "ghl",
    stage: "all",
    triggered_by: input.triggeredBy,
    status: "running",
    window_start: args.dateStart,
    window_end: args.dateEnd,
  } as never;

  const runInsert = await loose(service)
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

  // Calendario del launch — para la ventana compra+cierre (señal de tibio).
  // Si no tiene launch_date, warmWindow queda null y el adapter usa
  // [date_start, date_end] como fallback.
  const launchRowRes = await service
    .from("launches")
    .select(
      "launch_date, dur_captacion, dur_calentamiento, dur_compra, dur_cierre",
    )
    .eq("id", args.launchId)
    .maybeSingle();
  const launchRow = launchRowRes.data as {
    launch_date: string | null;
    dur_captacion: number;
    dur_calentamiento: number;
    dur_compra: number;
    dur_cierre: number;
  } | null;
  const calendar = tryComputeLaunchCalendar({
    launchDate: launchRow?.launch_date ?? undefined,
    durCaptacion: launchRow?.dur_captacion,
    durCalentamiento: launchRow?.dur_calentamiento,
    durCompra: launchRow?.dur_compra,
    durCierre: launchRow?.dur_cierre,
  });
  const warmWindow = calendar
    ? { start: calendar.compra.startDate, end: calendar.cierre.endDate }
    : null;

  // Incremental: tomamos started_at del último run con status='success'.
  // Filtramos por stage='all' o NULL para no confundir con runs viejos por
  // stage (appointments/conversations/contacts) que tenían su propio cutoff.
  const lastSuccessRes = await loose(service)
    .from("integration_runs")
    .select("started_at")
    .eq("launch_id", args.launchId)
    .eq("provider", "ghl")
    .eq("status", "success")
    .in("stage", ["all", null])
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const lastSuccessAt =
    (lastSuccessRes.data as { started_at: string } | null)?.started_at ?? null;

  const summary: GhlRunSummary = await runGhlSync({
    service,
    token,
    locationId: cfg.location_id,
    defaultCountry: cfg.default_country ?? "AR",
    projectId: args.projectId,
    launchId: args.launchId,
    since: args.dateStart,
    until: args.dateEnd,
    warmWindow,
    lastSuccessAt,
  });

  if (summary.status !== "success") {
    return await finalizeRun(service, runId, summary.status, 0, {
      stage: summary.stage,
      ...summary.detail,
      message: summary.message,
      retryAfterSeconds: summary.retryAfterSeconds ?? null,
    });
  }

  const written =
    summary.counts.contacts.created +
    summary.counts.contacts.updated +
    summary.counts.appointments.created +
    summary.counts.appointments.updated +
    summary.counts.opportunities.created +
    summary.counts.opportunities.updated;

  return await finalizeRun(service, runId, "success", written, {
    cause: "ghl_summary",
    counts: summary.counts,
    meta: summary.meta,
  });
}

/**
 * Bifurcación del orchestrator para SendFlow. Itera releases (1+), llama
 * /releases/{id}/analytics por cada una, suma `entered/removed/clicks`
 * acotados a la ventana del launch y upsertea UNA fila en
 * `launch_community_metrics` con conflict key (launch_id, provider,
 * window_start, window_end) — re-sync no duplica.
 *
 * Tolerancia a fallas parciales:
 *   - token_invalid en cualquier release → abort total (la key es la misma
 *     para todas las releases).
 *   - error/release_not_found en algunas releases pero otras OK → escribimos
 *     lo que sí tenemos y marcamos `partial` con detalle de cuáles fallaron.
 *   - Todas fallan → `error` (o `token_invalid` si todas fueron auth_failed).
 */
async function runSendflowBranch(args: {
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
    closed_at: null,
    integration_config: args.integrationConfig,
  };

  const cfg = readSendflowConfig(args.integrationConfig);
  if (cfg.release_ids.length === 0) {
    return await recordTerminalRun(
      service,
      input,
      launchSnapshot,
      "config_missing",
      "Configurá al menos una comunidad (release) de SendFlow antes de sincronizar.",
      { cause: "missing_release_ids" },
    );
  }

  const secretRes = await service
    .from("launch_secrets")
    .select("secret")
    .eq("launch_id", args.launchId)
    .eq("provider", "sendflow")
    .maybeSingle();
  const token = (secretRes.data as { secret: string } | null)?.secret ?? null;
  if (!token) {
    return await recordTerminalRun(
      service,
      input,
      launchSnapshot,
      "config_missing",
      "Falta la API Key de SendFlow. Pegala en la sección de integraciones del launch.",
      { cause: "missing_token" },
    );
  }

  // 1 fila en integration_runs (mismo patrón que Meta — sin stage)
  const runPayload = {
    launch_id: args.launchId,
    provider: "sendflow",
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

  // Fetch en paralelo — releases son independientes y la API no documenta
  // throttling por concurrencia para reads. Si en producción aparece rate
  // limit, secuenciamos en 3c.
  const results = await Promise.all(
    cfg.release_ids.map((releaseId) =>
      fetchSendflowAnalytics({
        token,
        releaseId,
        windowStart: args.dateStart,
        windowEnd: args.dateEnd,
      }),
    ),
  );

  // Si TODAS las releases fallaron con token_invalid → abort.
  const allTokenInvalid =
    results.length > 0 && results.every((r) => !r.ok && r.kind === "token_invalid");
  if (allTokenInvalid) {
    const first = results[0]!;
    if (!first.ok) {
      return await finalizeRun(service, runId, "token_invalid", 0, {
        ...first.detail,
        message: first.message,
      });
    }
  }

  // Cualquier release con token_invalid (aunque no sea todas) → abort, porque
  // la key es compartida. No tiene sentido escribir parcial con auth dudoso.
  const anyTokenInvalid = results.find((r) => !r.ok && r.kind === "token_invalid");
  if (anyTokenInvalid && !anyTokenInvalid.ok) {
    return await finalizeRun(service, runId, "token_invalid", 0, {
      ...anyTokenInvalid.detail,
      message: anyTokenInvalid.message,
    });
  }

  // Separar éxitos de fallas (que no sean token_invalid — ya abortamos arriba).
  const successes: SendflowAnalyticsSuccess[] = [];
  const failures: Array<{ releaseId: string; message: string; detail: Record<string, unknown> }> = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    const releaseId = cfg.release_ids[i]!;
    if (r.ok) {
      successes.push(r);
    } else {
      failures.push({ releaseId, message: r.message, detail: r.detail });
    }
  }

  // Si NADA funcionó (y no fue token_invalid), `error`.
  if (successes.length === 0) {
    return await finalizeRun(service, runId, "error", 0, {
      cause: "all_releases_failed",
      failures,
    });
  }

  // Suma acumulada de los éxitos.
  let entered = 0;
  let removed = 0;
  let clicks = 0;
  const rawReleases: Array<{
    release_id: string;
    entered: number;
    removed: number;
    clicks: number;
    /** Keys crudas de add.dates — para auditar el formato vía SQL. */
    add_date_keys: Record<string, number>;
  }> = [];
  for (const r of successes) {
    entered += r.entered;
    removed += r.removed;
    clicks += r.clicks;
    rawReleases.push({
      release_id: r.releaseId,
      entered: r.entered,
      removed: r.removed,
      clicks: r.clicks,
      add_date_keys: r.rawAddDateKeys,
    });
  }

  // Upsert por (launch, provider, ventana). 1 fila por sync.
  const row = {
    launch_id: args.launchId,
    provider: "sendflow",
    window_start: args.dateStart,
    window_end: args.dateEnd,
    entered,
    removed,
    clicks,
    raw: { releases: rawReleases },
    synced_at: new Date().toISOString(),
  } as never;

  // launch_community_metrics fue agregada en migration 0029 — el Database
  // type generado aún no la conoce hasta que el usuario regenere. Usamos el
  // helper loose() (mismo workaround que sync-ghl.ts para stage).
  const upsert = await loose(service)
    .from("launch_community_metrics")
    .upsert(row, {
      onConflict: "launch_id,provider,window_start,window_end",
    });

  if (upsert.error) {
    return await finalizeRun(service, runId, "error", 0, {
      cause: "upsert_failed",
      message: upsert.error.message,
    });
  }

  // Algunas releases fallaron pero otras escribieron → partial.
  if (failures.length > 0) {
    return await finalizeRun(service, runId, "partial", 1, {
      cause: "some_releases_failed",
      failed_releases: failures,
      written_releases: rawReleases.map((r) => r.release_id),
    });
  }

  return await finalizeRun(service, runId, "success", 1, null);
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

/**
 * Agrupa MetaInsightDay por `date` sumando spend/impressions/clicks/leads.
 * Necesario cuando Meta devuelve `level=campaign` con varias campañas: hay
 * N filas con la misma `date`, una por campaña, y el upsert no puede aplicar
 * UPDATE varias veces a la misma fila (launch_id, date, provider).
 *
 * El `raw` resultante guarda `{ items: [raw1, raw2, ...] }` con los originales
 * de cada campaña, para que el dashboard pueda inspeccionarlos individualmente
 * si hace falta.
 */
function mergeInsightsByDate(
  rows: ReadonlyArray<MetaInsightDay>,
): MetaInsightDay[] {
  const byDate = new Map<string, MetaInsightDay & { rawList: unknown[] }>();
  for (const row of rows) {
    const existing = byDate.get(row.date);
    if (!existing) {
      byDate.set(row.date, {
        date: row.date,
        spend: row.spend,
        impressions: row.impressions,
        clicks: row.clicks,
        leads: row.leads,
        raw: row.raw,
        rawList: [row.raw],
      });
      continue;
    }
    existing.spend += row.spend;
    existing.impressions += row.impressions;
    existing.clicks += row.clicks;
    existing.leads += row.leads;
    existing.rawList.push(row.raw);
  }
  return Array.from(byDate.values()).map((day) => ({
    date: day.date,
    spend: day.spend,
    impressions: day.impressions,
    clicks: day.clicks,
    leads: day.leads,
    raw: day.rawList.length === 1 ? day.rawList[0] : { items: day.rawList },
  }));
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
  // Para GHL marcamos stage='all' (el sync ahora es atómico). Para Meta queda
  // null — su sync no tiene noción de stage.
  const stage = input.provider === "ghl" ? "all" : null;
  const payload = {
    launch_id: launch.id,
    provider: input.provider,
    stage,
    triggered_by: input.triggeredBy,
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    status,
    rows_written: 0,
    error_detail: { ...detail, message },
    window_start: launch.date_start,
    window_end: launch.date_end,
  } as never;

  const inserted = await loose(service)
    .from("integration_runs")
    .insert(payload)
    .select("id")
    .maybeSingle();
  const runId = (inserted.data as { id: string } | null)?.id ?? "";

  // 7a: avisar al equipo de un sync que ni siquiera arrancó por falta de
  // config. Dedup por (launch, provider, YYYY-MM-DD) para no spamear cuando
  // el mismo usuario aprieta el botón varias veces el mismo día.
  await notifySyncEvent(service, {
    projectId: launch.project_id,
    launchId: launch.id,
    provider: input.provider,
    status,
    message,
  });

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

  // 7a: avisar al equipo si el sync terminó en estado no exitoso. Necesitamos
  // joinear con launches para obtener project_id — el run en sí solo tiene
  // launch_id. Si la query falla, swallow (la notificación es nice-to-have,
  // no critical path del sync).
  const ctx = await fetchLaunchContext(service, runId);
  if (status !== "success" && ctx) {
    await notifySyncEvent(service, {
      projectId: ctx.project_id,
      launchId: ctx.launch_id,
      provider: ctx.provider,
      status,
      message:
        errorDetail && typeof errorDetail.message === "string"
          ? (errorDetail.message as string)
          : null,
    });
  }

  // 7b: si el sync terminó OK, los datos cambiaron — re-evaluar reglas de
  // alerta. Fire-and-forget; un evaluator roto NO debe propagar al sync.
  if (status === "success" && ctx) {
    await evaluateAlertsForLaunch(ctx.launch_id);
  }

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

// ─── 7a — notificaciones de sistema ─────────────────────────────────────────

/**
 * Trae project_id + launch_id + provider del run para componer la notif.
 * Si el run no existe (edge case post-DELETE), devuelve null y el caller
 * se saltea la notificación.
 */
async function fetchLaunchContext(
  service: ServiceClient,
  runId: string,
): Promise<{
  project_id: string;
  launch_id: string;
  provider: string;
} | null> {
  const res = await loose(service)
    .from("integration_runs")
    .select("provider, launch_id, launches!inner(project_id)")
    .eq("id", runId)
    .maybeSingle();
  const row = res.data as
    | {
        provider: string;
        launch_id: string;
        launches: { project_id: string } | null;
      }
    | null;
  if (!row || !row.launches) return null;
  return {
    project_id: row.launches.project_id,
    launch_id: row.launch_id,
    provider: row.provider,
  };
}

/**
 * Trae los nombres legibles del proyecto y del launch para componer el body
 * de las notifs ("Proyecto X · Launch Y"). Dos queries baratas — proyecto y
 * launch son rows individuales con PK lookup. Si alguna falla, devolvemos
 * placeholder así la notif igual sale (no bloqueamos por nombres bonitos).
 */
async function fetchNotifDisplayNames(
  service: ServiceClient,
  projectId: string,
  launchId: string,
): Promise<{ projectName: string; launchName: string }> {
  const [projRes, launchRes] = await Promise.all([
    loose(service).from("projects").select("name").eq("id", projectId).maybeSingle(),
    loose(service).from("launches").select("name").eq("id", launchId).maybeSingle(),
  ]);
  const projectName =
    (projRes.data as { name?: string } | null)?.name ?? "Proyecto";
  const launchName =
    (launchRes.data as { name?: string } | null)?.name ?? "Lanzamiento";
  return { projectName, launchName };
}

/**
 * Header uniforme "Proyecto X · Launch Y" para el body de cualquier notif
 * del equipo. Lo precedemos con un newline para que en la UI quede arriba
 * del mensaje específico — el panel de la campanita renderiza body con
 * `line-clamp-2` así que las dos primeras líneas son las que cuentan.
 */
function buildNotifBodyHeader(projectName: string, launchName: string): string {
  return `${projectName} · ${launchName}`;
}

/**
 * Inserta una notificación al equipo cuando un sync termina mal. Mapea cada
 * estado terminal a un (type, severity, dedup_key) coherente:
 *
 *   - error           → severity error, dedup por ventana del sync.
 *   - token_invalid   → severity warning, dedup por día (recurrente hasta que
 *                       alguien rote el token).
 *   - rate_limited    → severity warning, dedup por hora (rate-limit transient).
 *   - partial         → severity warning, dedup por ventana.
 *   - config_missing  → severity warning, dedup por día.
 *
 * La llamada va al helper SQL `create_notification` (SECURITY DEFINER) que
 * absorbe duplicados via ON CONFLICT — la UI nunca ve la misma notif dos
 * veces aunque el usuario apriete el botón en loop.
 */
async function notifySyncEvent(
  service: ServiceClient,
  args: {
    projectId: string;
    launchId: string;
    provider: string;
    status: SyncLaunchResult["status"];
    message: string | null;
  },
): Promise<void> {
  const { projectId, launchId, provider, status, message } = args;

  const today = new Date().toISOString().slice(0, 10);
  const hourBucket = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH

  const { projectName, launchName } = await fetchNotifDisplayNames(
    service,
    projectId,
    launchId,
  );
  const header = buildNotifBodyHeader(projectName, launchName);
  const body = message ? `${header}\n${message}` : header;

  let type: string;
  let severity: "info" | "warning" | "error";
  let title: string;
  let dedupKey: string;
  switch (status) {
    case "error":
      type = "sync_failed";
      severity = "error";
      title = `Sync ${provider} falló`;
      dedupKey = `sync_failed:${launchId}:${provider}:${today}`;
      break;
    case "token_invalid":
      type = "sync_token_invalid";
      severity = "warning";
      title = `Token de ${provider} inválido`;
      dedupKey = `sync_token_invalid:${launchId}:${provider}:${today}`;
      break;
    case "rate_limited":
      type = "sync_rate_limited";
      severity = "warning";
      title = `${provider} aplicó rate limit`;
      dedupKey = `sync_rate_limited:${launchId}:${provider}:${hourBucket}`;
      break;
    case "partial":
      type = "sync_partial";
      severity = "warning";
      title = `Sync ${provider} terminó parcial`;
      dedupKey = `sync_partial:${launchId}:${provider}:${today}`;
      break;
    case "config_missing":
      type = "sync_config_missing";
      severity = "warning";
      title = `Falta configuración para ${provider}`;
      dedupKey = `sync_config_missing:${launchId}:${provider}:${today}`;
      break;
    default:
      return;
  }

  try {
    await loose(service).rpc("create_notification", {
      p_project_id: projectId,
      p_type: type,
      p_title: title,
      p_severity: severity,
      p_body: body,
      p_target_role: "team",
      p_target_user_id: null,
      p_launch_id: launchId,
      p_dedup_key: dedupKey,
      p_metadata: { provider, status, project_name: projectName, launch_name: launchName },
    });
  } catch {
    // Swallow — la notificación es nice-to-have, el sync ya cerró su run.
  }
}
