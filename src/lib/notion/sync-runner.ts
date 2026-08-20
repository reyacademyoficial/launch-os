import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  listPageComments as apiListPageComments,
  queryDatabase as apiQueryDatabase,
  NotionApiError,
} from "@/lib/notion/client";
import {
  mapNotionPageToInternalProject,
  type InternalProjectUpsertPayload,
} from "@/lib/notion/map-page-to-project";
import { parsePropertyMap } from "@/lib/notion/property-map";

/**
 * Núcleo del sync Notion → `internal_projects`. Independiente de auth y de
 * revalidación de rutas: eso se resuelve en el caller (server action o cron).
 *
 * Dos entradas al mismo runner:
 *  - Server action `syncNotionDatabase` / `syncAllEnabledNotionDatabases`
 *    (usuario en la UI) — usa RLS session client y hace full sync.
 *  - Cron `/api/cron/notion-sync` — usa service client y pide incremental
 *    (`sinceIso` = MAX(started_at) del último log ok/partial de esa DB).
 *
 * INCREMENTAL — limitación conocida
 *   El filter de Notion por `last_edited_time on_or_after` NO detecta pages
 *   que sólo recibieron comentarios nuevos (los comentarios no bumpean el
 *   last_edited_time de la page). Consecuencia: la cron pierde comments en
 *   pages sin edits de propiedades desde el último sync. El botón manual
 *   "Sincronizar Notion" en Ops corre full y recupera esos comments.
 */

// Las tablas `notion_*` no están en el tipo generado `Database` (todavía),
// así que aceptamos un supabase client "any" — mismo patrón que
// `src/lib/settlements/*.ts`. Las lecturas y escrituras hacen sus propios
// casts a shapes concretos.
type AnySupabase = SupabaseClient<any, any, any>;

export type SyncDatabaseRunResult =
  | {
      ok: true;
      fetched: number;
      upserted: number;
      skippedNoTitle: number;
      commentsUpserted: number;
      commentsFailed: number;
    }
  | { ok: false; error: string };

export type SyncAllRunResult = {
  workspacesRun: number;
  databasesRun: number;
  totalUpserted: number;
  totalCommentsUpserted: number;
  errors: ReadonlyArray<{ databaseId: string; error: string }>;
};

export interface RunNotionDatabaseSyncOpts {
  /**
   * Si está definido, filtra la query a Notion a pages con
   * `last_edited_time >= sinceIso`. Se usa para sync incremental (cron).
   * Manual = undefined = full sync.
   */
  readonly sinceIso?: string;
}

export interface RunAllOpts {
  /**
   * true = calcula anchor por DB desde notion_sync_log y pide incremental.
   * false (default) = full sync por DB (comportamiento del botón manual).
   */
  readonly incremental?: boolean;
}

/**
 * Corre el sync de UNA database. Loguea inicio/fin en notion_sync_log.
 * No revalida ni chequea auth — el caller decide.
 */
export async function runNotionDatabaseSync(
  databaseId: string,
  supabase: AnySupabase,
  opts: RunNotionDatabaseSyncOpts = {},
): Promise<SyncDatabaseRunResult> {
  // 1) Cargar DB + workspace (token + org)
  const dbRes = await supabase
    .from("notion_databases")
    .select("id, notion_id, workspace_id, property_map, enabled")
    .eq("id", databaseId)
    .maybeSingle();
  const db = dbRes.data as
    | {
        id: string;
        notion_id: string;
        workspace_id: string;
        property_map: unknown;
        enabled: boolean;
      }
    | null;
  if (!db) return { ok: false, error: "Database no encontrada." };

  const wsRes = await supabase
    .from("notion_workspaces")
    .select("secret_token, organization_id, enabled")
    .eq("id", db.workspace_id)
    .maybeSingle();
  const ws = wsRes.data as
    | { secret_token: string; organization_id: string; enabled: boolean }
    | null;
  if (!ws) return { ok: false, error: "Workspace no encontrado." };

  const map = parsePropertyMap(db.property_map);
  if (!map) {
    return {
      ok: false,
      error:
        "El mapping de propiedades no está configurado. Configuralo antes de sincronizar.",
    };
  }

  // 2) Log inicial 'running'
  const startRes = await supabase
    .from("notion_sync_log")
    .insert({
      workspace_id: db.workspace_id,
      database_id: db.id,
      kind: "database",
      status: "running",
    } as never)
    .select("id")
    .single();
  const logId = (startRes.data as { id: string } | null)?.id ?? null;

  async function finalizeLog(
    status: "ok" | "error" | "partial",
    itemsSynced: number,
    error?: string,
  ) {
    if (!logId) return;
    await supabase
      .from("notion_sync_log")
      .update({
        status,
        error: error ?? null,
        items_synced: itemsSynced,
        completed_at: new Date().toISOString(),
      } as never)
      .eq("id", logId);
  }

  // 3) Fetch pages de Notion (con filter incremental si aplica)
  const notionFilter = opts.sinceIso
    ? {
        timestamp: "last_edited_time" as const,
        last_edited_time: { on_or_after: opts.sinceIso },
      }
    : undefined;

  let pages: Awaited<ReturnType<typeof apiQueryDatabase>>;
  try {
    pages = await apiQueryDatabase(ws.secret_token, db.notion_id, {
      filter: notionFilter,
    });
  } catch (e) {
    await finalizeLog("error", 0, notionErrorMessage(e));
    return { ok: false, error: notionErrorMessage(e) };
  }

  // 4) Precomputar assignee resolver (notion_user_id → kg_person_id)
  const usersRes = await supabase
    .from("notion_users")
    .select("notion_user_id, kg_person_id")
    .eq("workspace_id", db.workspace_id);
  const assigneeMap = new Map<string, string | null>();
  for (const r of (usersRes.data ?? []) as Array<{
    notion_user_id: string;
    kg_person_id: string | null;
  }>) {
    assigneeMap.set(r.notion_user_id, r.kg_person_id);
  }
  const resolveAssignee = (nu: string): string | null =>
    assigneeMap.get(nu) ?? null;

  // 5) Mapear y upsertar page por page
  const nowIso = new Date().toISOString();
  let upserted = 0;
  let skippedNoTitle = 0;
  const payloads: InternalProjectUpsertPayload[] = [];
  // Guardamos el ownerIds resuelto por notion_page_id para poder reemplazar
  // la junction internal_project_owners después del upsert (paso 6b).
  const ownersByPageId = new Map<string, readonly string[]>();

  for (const page of pages) {
    const mapped = mapNotionPageToInternalProject(page, map, {
      organizationId: ws.organization_id,
      workspaceId: db.workspace_id,
      databaseId: db.id,
      assigneeToKgPerson: resolveAssignee,
      nowIso,
    });
    if (!mapped.ok) {
      if (mapped.reason === "missing-title") skippedNoTitle += 1;
      continue;
    }
    payloads.push(mapped.result.payload);
    ownersByPageId.set(mapped.result.payload.notion_page_id, mapped.result.ownerIds);
  }

  // 6) Upsert por notion_page_id
  if (payloads.length > 0) {
    const { error: upsertErr } = await supabase
      .from("internal_projects")
      .upsert(payloads as never, { onConflict: "notion_page_id" });
    if (upsertErr) {
      await finalizeLog("partial", upserted, upsertErr.message);
      return { ok: false, error: upsertErr.message };
    }
    upserted = payloads.length;
  }

  // 6b) Reemplazar owners en la junction. Notion es la fuente de verdad —
  //     cualquier owner añadido manualmente en KG a un project sourced se
  //     pisa en cada sync. Esto es simétrico con status/priority.
  //
  //     Estrategia: DELETE bulk de todos los owners de los projects
  //     tocados en este run, luego INSERT bulk de los nuevos. Dos queries
  //     total en vez de 2×N.
  let projectIdByPage = new Map<string, string>();
  if (payloads.length > 0) {
    const pageIds = payloads.map((p) => p.notion_page_id);
    const projectsRes = await supabase
      .from("internal_projects")
      .select("id, notion_page_id")
      .in("notion_page_id", pageIds);
    for (const r of (projectsRes.data ?? []) as Array<{
      id: string;
      notion_page_id: string;
    }>) {
      projectIdByPage.set(r.notion_page_id, r.id);
    }

    const projectIds = Array.from(projectIdByPage.values());
    if (projectIds.length > 0) {
      await supabase
        .from("internal_project_owners")
        .delete()
        .in("internal_project_id", projectIds);

      const ownerRows: Array<{
        internal_project_id: string;
        person_id: string;
        organization_id: string;
      }> = [];
      for (const [pageId, ownerIds] of ownersByPageId.entries()) {
        const projectId = projectIdByPage.get(pageId);
        if (!projectId) continue;
        for (const personId of ownerIds) {
          ownerRows.push({
            internal_project_id: projectId,
            person_id: personId,
            organization_id: ws.organization_id,
          });
        }
      }
      if (ownerRows.length > 0) {
        // on_conflict do_nothing por si dos personas Notion mapean a la
        // misma KG persona en el mismo project (aunque el mapper ya
        // dedupea, defensivo contra corner cases).
        await supabase
          .from("internal_project_owners")
          .upsert(ownerRows as never, {
            onConflict: "internal_project_id,person_id",
            ignoreDuplicates: true,
          });
      }
    }
  }

  // 7) Sync comentarios: sólo para las pages devueltas en este run. En modo
  //    incremental esto no cubre pages con comments nuevos pero sin edits
  //    (ver limitación al tope del archivo).
  let commentsUpserted = 0;
  let commentsFailed = 0;
  if (payloads.length > 0) {
    // projectIdByPage ya está poblado por el paso 6b.

    for (const page of pages) {
      const projectId = projectIdByPage.get(page.id);
      if (!projectId) continue;

      let comments: Awaited<ReturnType<typeof apiListPageComments>>;
      try {
        comments = await apiListPageComments(ws.secret_token, page.id);
      } catch {
        commentsFailed += 1;
        continue;
      }

      if (comments.length === 0) continue;

      const commentPayloads = comments.map((c) => ({
        organization_id: ws.organization_id,
        internal_project_id: projectId,
        notion_comment_id: c.id,
        notion_user_id: c.notion_user_id,
        content_plain: c.content_plain,
        created_time: c.created_time,
        updated_time: c.last_edited_time,
        synced_at: nowIso,
      }));

      const { error: cErr } = await supabase
        .from("internal_project_notion_comments")
        .upsert(commentPayloads as never, {
          onConflict: "notion_comment_id",
        });
      if (cErr) {
        commentsFailed += 1;
        continue;
      }
      commentsUpserted += comments.length;
    }
  }

  const finalStatus: "ok" | "partial" =
    commentsFailed > 0 ? "partial" : "ok";
  await finalizeLog(
    finalStatus,
    upserted + commentsUpserted,
    commentsFailed > 0
      ? `Fallaron comentarios en ${commentsFailed} page(s).`
      : undefined,
  );

  return {
    ok: true,
    fetched: pages.length,
    upserted,
    skippedNoTitle,
    commentsUpserted,
    commentsFailed,
  };
}

/**
 * Enumera todas las DBs enabled (cuyo workspace también esté enabled) y las
 * corre secuencialmente. Si opts.incremental, calcula el anchor por DB desde
 * notion_sync_log antes de cada run.
 */
export async function runAllEnabledNotionDatabases(
  supabase: AnySupabase,
  opts: RunAllOpts = {},
): Promise<SyncAllRunResult> {
  const dbsRes = await supabase
    .from("notion_databases")
    .select("id, workspace_id, notion_workspaces!inner(enabled)")
    .eq("enabled", true);
  const rows = (dbsRes.data ?? []) as unknown as Array<{
    id: string;
    workspace_id: string;
    notion_workspaces: { enabled: boolean };
  }>;

  const activeRows = rows.filter((r) => r.notion_workspaces.enabled);
  const workspacesRun = new Set(activeRows.map((r) => r.workspace_id)).size;

  const errors: Array<{ databaseId: string; error: string }> = [];
  let totalUpserted = 0;
  let totalCommentsUpserted = 0;

  for (const row of activeRows) {
    const sinceIso = opts.incremental
      ? await computeIncrementalAnchor(row.id, supabase)
      : undefined;

    const res = await runNotionDatabaseSync(row.id, supabase, { sinceIso });
    if (res.ok) {
      totalUpserted += res.upserted;
      totalCommentsUpserted += res.commentsUpserted;
    } else {
      errors.push({ databaseId: row.id, error: res.error });
    }
  }

  return {
    workspacesRun,
    databasesRun: activeRows.length,
    totalUpserted,
    totalCommentsUpserted,
    errors,
  };
}

/**
 * Devuelve el MAX(started_at) del último notion_sync_log en status ok/partial
 * para esa database. undefined si nunca corrió con éxito (primer run = full).
 *
 * Usamos `started_at` (no `completed_at`) porque cualquier edit hecho DESPUÉS
 * de que el sync arrancó pudo no haberse leído — mejor re-sincronizarlo. Sí,
 * eso implica solaparse un poco con el sync anterior; el upsert es idempotente.
 */
export async function computeIncrementalAnchor(
  databaseId: string,
  supabase: AnySupabase,
): Promise<string | undefined> {
  const res = await supabase
    .from("notion_sync_log")
    .select("started_at")
    .eq("database_id", databaseId)
    .eq("kind", "database")
    .in("status", ["ok", "partial"])
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = res.data as { started_at: string } | null;
  return row?.started_at ?? undefined;
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function notionErrorMessage(e: unknown): string {
  if (e instanceof NotionApiError) {
    if (e.status === 401) {
      return "Token inválido o revocado. Revisá que copiaste el 'Internal Integration Secret' correctamente.";
    }
    if (e.status === 403) {
      return "El token es válido pero no tiene permisos suficientes. Revisá las 'Capabilities' de la integration en Notion.";
    }
    if (e.status === 429) {
      return "Notion está limitando las peticiones. Esperá unos segundos e intentá de nuevo.";
    }
    return `Notion respondió ${e.status}: ${e.message}`;
  }
  if (e instanceof Error) return e.message;
  return "Error desconocido al hablar con Notion.";
}
