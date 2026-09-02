import "server-only";

import {
  fetchGhlContactCountsByDay,
  fetchGhlPipelineLeadCounts,
  type DailyLeadCountsMeta,
  type GhlFetchFailure,
} from "./ghl";

import type { createServiceClient } from "@/lib/supabase/service";

/**
 * Sync GHL — conteo de leads del launch.
 *
 * Trae dos números, ambos de solo lectura sobre GHL:
 *
 *   1) Leads nuevos por día: `POST /contacts/search` con filtro `dateAdded`
 *      acotado a UN día y `pageLimit: 1` — devuelve el total, no el payload
 *      de los contacts. Se persiste en `launch_daily_ads` con provider='ghl'.
 *      `mergeDailyData` ignora ese provider, así que no se suma a los leads
 *      de Meta; la UI lo lee aparte para la curva diaria.
 *
 *   2) Leads por vendedor en la pipeline configurada:
 *      `GET /opportunities/search` agrupado por `assignedTo`, traducido a
 *      `team_member_id` vía `ghl_user_mappings`. Alimenta la columna de leads
 *      del ranking comercial y el KPI de leads del launch.
 *
 * Lo que NO hace:
 *   - No pagina `/contacts/` ni `/conversations/search`. Ambos existían para
 *     mantener `leads.team_member_id` al día, que quedó obsoleto cuando la
 *     asignación de vendedor pasó a resolverse al cargar la venta. Eran
 *     también el grueso del costo en rate limit del sync.
 *   - No crea ni modifica leads. Los alimenta Meta (formularios de campaña) y
 *     la carga manual de orgánicos.
 */

type ServiceClient = ReturnType<typeof createServiceClient>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseClient = { from: (name: string) => any };
function loose(service: ServiceClient): LooseClient {
  return service as unknown as LooseClient;
}

export interface GhlCombinedCounts {
  /**
   * Leads nuevos en el launch según GHL: `total` acumulado de
   * `POST /contacts/search` con filtro `dateAdded` por día × N días del
   * launch. Solo el count — no baja el payload de los contacts.
   */
  new_leads_in_launch: number;
  /** Filas escritas en `launch_daily_ads` (días con al menos 1 lead). */
  daily_rows_written: number;
  /**
   * Total de leads contados en la pipeline GHL configurada (suma de todos los
   * assignedTo). 0 si no hay pipeline configurada o si el fetch falló.
   */
  pipeline_leads_total: number;
  /** Cuántos `assignedTo` de la pipeline resolvieron a un team_member. */
  pipeline_mapped_users: number;
}

interface GhlRunMeta {
  /** Meta del fetch por día del count: días consultados, errores tolerados. */
  daily_counts: DailyLeadCountsMeta;
  /**
   * GHL user ids vistos como `assignedTo` en la pipeline pero SIN fila en
   * `ghl_user_mappings`. Cap 20 para no inflar la respuesta. Útil para saber
   * "por qué el ranking dice X leads en lugar de Y".
   */
  unmapped_ghl_user_ids: string[];
  /** Ventana completa del launch — la usada para el count de leads nuevos. */
  launch_window: { start: string; end: string };
  /** Presente solo si el sync de pipeline falló (soft-failure). */
  pipeline_error?: string;
  /** Diagnóstico del fetch de pipeline (keys de body, total GHL, etc.). */
  pipeline_diag?: import("./ghl").GhlPipelineFetchDiag;
}

export type GhlRunSummary =
  | {
      status: "success";
      counts: GhlCombinedCounts;
      meta: GhlRunMeta;
    }
  | {
      status: "token_invalid" | "rate_limited" | "error";
      stage: "contacts" | "mappings" | "updates";
      message: string;
      detail: Record<string, unknown>;
      retryAfterSeconds?: number | null;
    };

export interface RunGhlSyncArgs {
  service: ServiceClient;
  token: string;
  locationId: string;
  projectId: string;
  launchId: string;
  since: string;
  until: string;
  /** Pipeline ID de GHL. Si está presente, se contabilizan los leads por vendedor. */
  pipelineId?: string | null;
}

const UNMAPPED_SAMPLE_LIMIT = 20;

export async function runGhlSync(args: RunGhlSyncArgs): Promise<GhlRunSummary> {
  const launchWindow = { start: args.since, end: args.until };

  // 1) Mappings GHL user → team_member del proyecto. Los usa el conteo de
  //    pipeline para atribuir leads a cada vendedor.
  const mappingRes = await loose(args.service)
    .from("ghl_user_mappings")
    .select("ghl_user_id, team_member_id")
    .eq("project_id", args.projectId);
  if (mappingRes.error) {
    return {
      status: "error",
      stage: "mappings",
      message: `No pude leer ghl_user_mappings: ${mappingRes.error.message}`,
      detail: { code: mappingRes.error.code ?? null },
    };
  }
  const mappings = new Map<string, string>(
    ((mappingRes.data ?? []) as Array<{ ghl_user_id: string; team_member_id: string }>).map(
      (m) => [m.ghl_user_id, m.team_member_id],
    ),
  );

  // 2) Count de leads nuevos por día del launch.
  const dailyCountsResult = await fetchGhlContactCountsByDay({
    token: args.token,
    locationId: args.locationId,
    since: launchWindow.start,
    until: launchWindow.end,
  });
  if (!dailyCountsResult.ok) return propagateFailure(dailyCountsResult, "contacts");

  // 3) Persistir el count por día en launch_daily_ads con provider='ghl'.
  let newLeadsInLaunch = 0;
  const nowIso = new Date().toISOString();
  const dailyRowsToUpsert: Record<string, unknown>[] = [];
  for (const r of dailyCountsResult.rows) {
    newLeadsInLaunch += r.total;
    if (r.total === 0) continue; // no upsertear días sin leads
    dailyRowsToUpsert.push({
      launch_id: args.launchId,
      date: r.date,
      provider: "ghl",
      spend: 0,
      impressions: 0,
      clicks: 0,
      leads: r.total,
      // raw es NOT NULL con default '{}'. Sin payload crudo real para
      // guardar acá (usamos POST /contacts/search solo por el count).
      raw: {},
      synced_at: nowIso,
    });
  }

  if (dailyRowsToUpsert.length > 0) {
    const upsert = await loose(args.service)
      .from("launch_daily_ads")
      .upsert(dailyRowsToUpsert, { onConflict: "launch_id,date,provider" });
    if (upsert.error) {
      return {
        status: "error",
        stage: "updates",
        message: `Falló el upsert de leads GHL por día: ${upsert.error.message}`,
        detail: {
          code: upsert.error.code ?? null,
          rows_attempted: dailyRowsToUpsert.length,
        },
      };
    }
  }

  // 4) Pipeline lead counts — opcional. Si hay pipeline configurada, contamos
  //    leads por vendedor y los persistimos en ghl_pipeline_lead_counts.
  //    Es soft-failure: si falla, el sync sigue y el error queda en el meta.
  let pipelineLeadsTotal = 0;
  let pipelineMappedUsers = 0;
  let unmappedGhlUserIds: string[] = [];
  let pipelineError: string | null = null;
  let pipelineDiag: import("./ghl").GhlPipelineFetchDiag | undefined;
  if (args.pipelineId) {
    const pipelineResult = await syncPipelineLeadCounts({
      service: args.service,
      token: args.token,
      locationId: args.locationId,
      pipelineId: args.pipelineId,
      launchId: args.launchId,
      mappings,
    });
    pipelineLeadsTotal = pipelineResult.total;
    pipelineMappedUsers = pipelineResult.mappedUsers;
    unmappedGhlUserIds = pipelineResult.unmappedGhlUserIds;
    pipelineError = pipelineResult.error ?? null;
    pipelineDiag = pipelineResult.diag;
  }

  const counts: GhlCombinedCounts = {
    new_leads_in_launch: newLeadsInLaunch,
    daily_rows_written: dailyRowsToUpsert.length,
    pipeline_leads_total: pipelineLeadsTotal,
    pipeline_mapped_users: pipelineMappedUsers,
  };
  const meta: GhlRunMeta = {
    daily_counts: dailyCountsResult.meta,
    unmapped_ghl_user_ids: unmappedGhlUserIds,
    launch_window: launchWindow,
    ...(pipelineError ? { pipeline_error: pipelineError } : {}),
    ...(pipelineDiag ? { pipeline_diag: pipelineDiag } : {}),
  };

  return { status: "success", counts, meta };
}

// ─── Pipeline lead counts ─────────────────────────────────────────────────

interface SyncPipelineArgs {
  service: ServiceClient;
  token: string;
  locationId: string;
  pipelineId: string;
  launchId: string;
  mappings: Map<string, string>;
}

interface SyncPipelineResult {
  total: number;
  mappedUsers: number;
  unmappedGhlUserIds: string[];
  error?: string;
  diag?: import("./ghl").GhlPipelineFetchDiag;
}

/**
 * Trae los leads de la pipeline, los agrupa por `assignedTo` (ghl_user_id),
 * resuelve el team_member_id via mappings y sobreescribe la tabla
 * `ghl_pipeline_lead_counts` (delete + insert). Soft-failure: si GHL falla,
 * devuelve el error sin frenar el sync principal.
 *
 * Los `assignedTo` sin fila en `ghl_user_mappings` se guardan igual con
 * `team_member_id = null` — caen en la fila "Sin asignar" del ranking y
 * suman al total, pero quedan listados en el meta para diagnóstico.
 */
async function syncPipelineLeadCounts(args: SyncPipelineArgs): Promise<SyncPipelineResult> {
  const result = await fetchGhlPipelineLeadCounts(
    args.token,
    args.locationId,
    args.pipelineId,
  );
  if (!result.ok) {
    const detail = result.detail?.responseBody
      ? ` | GHL body: ${JSON.stringify(result.detail.responseBody)}`
      : "";
    return {
      total: 0,
      mappedUsers: 0,
      unmappedGhlUserIds: [],
      error: `Pipeline fetch falló (${result.kind}): ${result.message}${detail}`,
    };
  }

  if (result.rows.length === 0) {
    // No hay filas — borramos las anteriores y salimos.
    await loose(args.service)
      .from("ghl_pipeline_lead_counts")
      .delete()
      .eq("launch_id", args.launchId);
    return {
      total: 0,
      mappedUsers: 0,
      unmappedGhlUserIds: [],
      diag: result.diag,
    };
  }

  const total = result.rows.reduce((s, r) => s + r.count, 0);

  const unmapped = new Set<string>();
  let mappedUsers = 0;
  for (const r of result.rows) {
    // `__unassigned__` es el bucket de oportunidades sin assignedTo — no es
    // un GHL user real, no cuenta como mapeo faltante.
    if (r.ghlUserId === "__unassigned__") continue;
    if (args.mappings.has(r.ghlUserId)) {
      mappedUsers++;
    } else if (unmapped.size < UNMAPPED_SAMPLE_LIMIT) {
      unmapped.add(r.ghlUserId);
    }
  }

  // Delete existentes para este launch (re-escritura completa)
  const delRes = await loose(args.service)
    .from("ghl_pipeline_lead_counts")
    .delete()
    .eq("launch_id", args.launchId);
  if (delRes.error) {
    return {
      total,
      mappedUsers,
      unmappedGhlUserIds: Array.from(unmapped),
      error: `No se pudo limpiar ghl_pipeline_lead_counts: ${delRes.error.message}`,
    };
  }

  const rows = result.rows.map((r) => ({
    launch_id: args.launchId,
    ghl_user_id: r.ghlUserId,
    team_member_id: args.mappings.get(r.ghlUserId) ?? null,
    lead_count: r.count,
    synced_at: new Date().toISOString(),
  }));

  const insRes = await loose(args.service)
    .from("ghl_pipeline_lead_counts")
    .insert(rows);
  if (insRes.error) {
    return {
      total,
      mappedUsers,
      unmappedGhlUserIds: Array.from(unmapped),
      error: `No se pudo insertar en ghl_pipeline_lead_counts: ${insRes.error.message}`,
    };
  }

  return {
    total,
    mappedUsers,
    unmappedGhlUserIds: Array.from(unmapped),
    diag: result.diag,
  };
}

// ─── helpers ───────────────────────────────────────────────────────────────

function propagateFailure(
  failure: GhlFetchFailure,
  stage: "contacts",
): GhlRunSummary {
  return {
    status: failure.kind,
    stage,
    message: failure.message,
    detail: failure.detail,
    retryAfterSeconds: failure.retryAfterSeconds ?? null,
  };
}
