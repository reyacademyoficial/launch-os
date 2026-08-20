"use server";

import { revalidatePath } from "next/cache";

import {
  listDatabases as apiListDatabases,
  listUsers as apiListUsers,
  NotionApiError,
  postPageComment as apiPostPageComment,
  retrieveDatabase as apiRetrieveDatabase,
  retrieveParentTitle as apiRetrieveParentTitle,
  whoAmI as apiWhoAmI,
  type NotionDatabaseSchema,
  type NotionRichTextBlock,
} from "@/lib/notion/client";
import {
  serializePropertyMap,
  type NotionPropertyMap,
} from "@/lib/notion/property-map";
import {
  runAllEnabledNotionDatabases,
  runNotionDatabaseSync,
  type SyncAllRunResult,
  type SyncDatabaseRunResult,
} from "@/lib/notion/sync-runner";
import { resolveCurrentOrganizationId } from "@/lib/organization/current";
import { requireRole } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

// ═══════════════════════════════════════════════════════════════════════════
// Contratos de retorno
// ═══════════════════════════════════════════════════════════════════════════

export type CreateWorkspaceState =
  | { ok: true; workspaceId: string; workspaceName: string | null }
  | { error: string }
  | null;

export type UpdateWorkspaceState =
  | { ok: true }
  | { error: string }
  | null;

export type DeleteWorkspaceResult = { ok: true } | { error: string };

export type TestConnectionResult =
  | {
      ok: true;
      workspaceName: string | null;
      botId: string;
    }
  | { ok: false; error: string };

export type DiscoverDatabasesResult =
  | {
      ok: true;
      // Cuántas DBs había antes vs ahora. `discovered` = las que aparecen
      // ahora que ANTES no estaban (upsert insertó nuevas).
      discovered: number;
      total: number;
    }
  | { ok: false; error: string };

// ═══════════════════════════════════════════════════════════════════════════
// testConnection — probar el token contra la API Notion sin escribir
// ═══════════════════════════════════════════════════════════════════════════

export async function testNotionConnection(
  token: string,
): Promise<TestConnectionResult> {
  await requireRole("superadmin");

  const trimmed = token.trim();
  if (!trimmed) {
    return { ok: false, error: "El token no puede estar vacío." };
  }

  try {
    const bot = await apiWhoAmI(trimmed);
    return {
      ok: true,
      workspaceName: bot.workspace_name,
      botId: bot.bot_id,
    };
  } catch (e) {
    return { ok: false, error: notionErrorMessage(e) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// createWorkspace — guarda el token después de probarlo
// ═══════════════════════════════════════════════════════════════════════════

export async function createNotionWorkspace(
  _prev: CreateWorkspaceState,
  formData: FormData,
): Promise<CreateWorkspaceState> {
  await requireRole("superadmin");

  const name = String(formData.get("name") ?? "").trim();
  const token = String(formData.get("secret_token") ?? "").trim();

  if (name.length === 0) return { error: "Elegí un nombre para el workspace." };
  if (token.length === 0) return { error: "Pegá el token de la integration." };

  // Test connection antes de guardar — si el token es inválido, no queremos
  // filas rotas en la tabla que después habría que limpiar.
  const test = await testNotionConnection(token);
  if (!test.ok) {
    return { error: `La conexión falló: ${test.error}` };
  }

  let organizationId: string | null;
  try {
    organizationId = await resolveCurrentOrganizationId();
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Error resolviendo la organización.",
    };
  }
  if (!organizationId) {
    return { error: "No pudimos resolver tu organización." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notion_workspaces")
    .insert({
      organization_id: organizationId,
      name,
      secret_token: token,
      enabled: true,
      last_verified_at: new Date().toISOString(),
      last_verify_ok: true,
    } as never)
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { error: "Ya existe un workspace con ese nombre en tu organización." };
    }
    return { error: error.message };
  }

  const inserted = data as { id: string } | null;
  if (!inserted) return { error: "El insert no devolvió fila." };

  revalidatePath("/configuracion/notion");
  return {
    ok: true,
    workspaceId: inserted.id,
    workspaceName: test.workspaceName,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// toggleWorkspaceEnabled + deleteWorkspace
// ═══════════════════════════════════════════════════════════════════════════

export async function setNotionWorkspaceEnabled(
  workspaceId: string,
  enabled: boolean,
): Promise<UpdateWorkspaceState> {
  await requireRole("superadmin");

  const supabase = await createClient();
  const { error } = await supabase
    .from("notion_workspaces")
    .update({ enabled } as never)
    .eq("id", workspaceId);

  if (error) return { error: error.message };
  revalidatePath("/configuracion/notion");
  return { ok: true };
}

export async function deleteNotionWorkspace(
  workspaceId: string,
): Promise<DeleteWorkspaceResult> {
  await requireRole("superadmin");

  const supabase = await createClient();
  const { error } = await supabase
    .from("notion_workspaces")
    .delete()
    .eq("id", workspaceId);

  if (error) return { error: error.message };
  revalidatePath("/configuracion/notion");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// discoverDatabases — trae la lista de DBs y las upserta en notion_databases
// (enabled=false por default; el usuario decide cuáles activar en 4c)
// ═══════════════════════════════════════════════════════════════════════════

export async function discoverNotionDatabases(
  workspaceId: string,
): Promise<DiscoverDatabasesResult> {
  await requireRole("superadmin");

  const supabase = await createClient();

  // Fetch del token — SELECT trae el token porque el llamante es superadmin
  // (RLS ya lo restringió).
  const wsRes = await supabase
    .from("notion_workspaces")
    .select("id, secret_token")
    .eq("id", workspaceId)
    .maybeSingle();

  const ws = wsRes.data as { id: string; secret_token: string } | null;
  if (wsRes.error || !ws) {
    return { ok: false, error: "No pudimos encontrar el workspace." };
  }

  let dbs: Awaited<ReturnType<typeof apiListDatabases>>;
  try {
    dbs = await apiListDatabases(ws.secret_token);
  } catch (e) {
    return { ok: false, error: notionErrorMessage(e) };
  }

  // Traemos las notion_id ya conocidas para calcular cuántas son nuevas.
  const existingRes = await supabase
    .from("notion_databases")
    .select("notion_id")
    .eq("workspace_id", workspaceId);
  const existing = new Set(
    ((existingRes.data ?? []) as { notion_id: string }[]).map(
      (r) => r.notion_id,
    ),
  );

  // Split entre nuevas (INSERT con defaults enabled=false + property_map={})
  // y ya conocidas (UPDATE de metadata visual + nombre para preservar
  // enabled + mapping configurado por el usuario). Un upsert masivo pisaría
  // los defaults, por eso lo separamos en dos operaciones explícitas.
  const newOnes = dbs.filter((d) => !existing.has(d.id));
  const existingOnes = dbs.filter((d) => existing.has(d.id));

  // Resolver `parent_title` para cada padre único con una sola llamada.
  // Muchos DBs pueden compartir el mismo teamspace/page padre — sin cache
  // el discover haría N llamadas redundantes.
  const secretToken = ws.secret_token;
  const parentCache = new Map<string, string | null>();
  async function resolveParentTitle(
    parentType: "page_id" | "database_id" | null,
    parentId: string | null,
  ): Promise<string | null> {
    if (!parentType || !parentId) return null;
    const cacheKey = `${parentType}:${parentId}`;
    if (parentCache.has(cacheKey)) return parentCache.get(cacheKey) ?? null;
    const title = await apiRetrieveParentTitle(
      secretToken,
      parentType,
      parentId,
    );
    parentCache.set(cacheKey, title);
    return title;
  }

  if (newOnes.length > 0) {
    const rows = [];
    for (const d of newOnes) {
      const parentTitle =
        d.parent_type === "page_id" || d.parent_type === "database_id"
          ? await resolveParentTitle(d.parent_type, d.parent_id)
          : null;
      rows.push({
        workspace_id: workspaceId,
        notion_id: d.id,
        name: d.title_plain,
        notion_url: d.url,
        icon: d.icon_emoji,
        parent_type: d.parent_type,
        parent_id: d.parent_id,
        parent_title: parentTitle,
      });
    }
    const { error: insErr } = await supabase
      .from("notion_databases")
      .insert(rows as never);
    if (insErr) return { ok: false, error: insErr.message };
  }

  // Actualizar metadata visual y nombre por si algo cambió en Notion.
  // Iteramos: pocas DBs típicas (< 20 por workspace), no vale batch update.
  for (const d of existingOnes) {
    const parentTitle =
      d.parent_type === "page_id" || d.parent_type === "database_id"
        ? await resolveParentTitle(d.parent_type, d.parent_id)
        : null;
    await supabase
      .from("notion_databases")
      .update({
        name: d.title_plain,
        notion_url: d.url,
        icon: d.icon_emoji,
        parent_type: d.parent_type,
        parent_id: d.parent_id,
        parent_title: parentTitle,
      } as never)
      .eq("workspace_id", workspaceId)
      .eq("notion_id", d.id);
  }

  revalidatePath("/configuracion/notion");
  return {
    ok: true,
    discovered: newOnes.length,
    total: dbs.length,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// syncNotionUsers — trae users del workspace desde Notion + upsert + auto-match
// ═══════════════════════════════════════════════════════════════════════════
//
// Solo persiste users con `type='person'` — bots (integrations) no aportan
// al mapeo y ensucian la UI. Auto-matching por email lowercased contra
// `organization_people`: solo pisa `kg_person_id` si el user Notion NO tenía
// mapping previo (no queremos sobrescribir asignaciones manuales del humano).
// Loguea la corrida en notion_sync_log.

export type SyncNotionUsersResult =
  | {
      ok: true;
      fetched: number;
      persons: number;
      inserted: number;
      updated: number;
      autoMatched: number;
    }
  | { ok: false; error: string };

export async function syncNotionUsers(
  workspaceId: string,
): Promise<SyncNotionUsersResult> {
  await requireRole("superadmin");

  const supabase = await createClient();

  const wsRes = await supabase
    .from("notion_workspaces")
    .select("id, organization_id, secret_token")
    .eq("id", workspaceId)
    .maybeSingle();

  const ws = wsRes.data as
    | { id: string; organization_id: string; secret_token: string }
    | null;
  if (wsRes.error || !ws) {
    return { ok: false, error: "No pudimos encontrar el workspace." };
  }

  // Log inicial en 'running' — nos permite detectar syncs que colgaron
  // (updateamos a 'ok' o 'error' al finalizar). El id devuelto es el que
  // actualizamos al cierre.
  const startRes = await supabase
    .from("notion_sync_log")
    .insert({
      workspace_id: workspaceId,
      kind: "users",
      status: "running",
    } as never)
    .select("id")
    .single();
  const logRow = startRes.data as { id: string } | null;
  const logId = logRow?.id ?? null;

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

  // ─── Fetch de Notion ──────────────────────────────────────────────────
  let notionUsers: Awaited<ReturnType<typeof apiListUsers>>;
  try {
    notionUsers = await apiListUsers(ws.secret_token);
  } catch (e) {
    await finalizeLog("error", 0, notionErrorMessage(e));
    return { ok: false, error: notionErrorMessage(e) };
  }

  const persons = notionUsers.filter((u) => u.type === "person");

  // ─── Existing mapping — para saber cuáles ya tenían kg_person_id ──────
  // No queremos pisar mappings manuales del humano con el auto-match. Solo
  // populamos kg_person_id si estaba null.
  const existingRes = await supabase
    .from("notion_users")
    .select("notion_user_id, kg_person_id")
    .eq("workspace_id", workspaceId);
  const existingById = new Map<string, string | null>(
    ((existingRes.data ?? []) as Array<{
      notion_user_id: string;
      kg_person_id: string | null;
    }>).map((r) => [r.notion_user_id, r.kg_person_id]),
  );

  // ─── Personas de la org por email (lower) para auto-match ─────────────
  const peopleRes = await supabase
    .from("organization_people")
    .select("id, email, active")
    .eq("organization_id", ws.organization_id);
  const people = (peopleRes.data ?? []) as Array<{
    id: string;
    email: string | null;
    active: boolean;
  }>;
  const personIdByEmail = new Map<string, string>();
  for (const p of people) {
    if (!p.active) continue;
    const em = (p.email ?? "").trim().toLowerCase();
    if (em && !personIdByEmail.has(em)) personIdByEmail.set(em, p.id);
  }

  // ─── Upsert row por row — la cardinalidad es baja (users < 100 típico) ──
  let inserted = 0;
  let updated = 0;
  let autoMatched = 0;

  for (const u of persons) {
    const existingMapping = existingById.get(u.id);
    const isNew = !existingById.has(u.id);
    const emLower = (u.email ?? "").trim().toLowerCase();
    // Auto-match solo si (a) es fila nueva o (b) existente sin mapping.
    let resolvedPersonId: string | null | undefined = existingMapping ?? null;
    if (
      (isNew || existingMapping == null) &&
      emLower.length > 0 &&
      personIdByEmail.has(emLower)
    ) {
      resolvedPersonId = personIdByEmail.get(emLower) ?? null;
      if (resolvedPersonId) autoMatched += 1;
    }

    const payload = {
      workspace_id: workspaceId,
      notion_user_id: u.id,
      email: u.email,
      name: u.name,
      avatar_url: u.avatar_url,
      kg_person_id: resolvedPersonId,
    };

    if (isNew) {
      const { error } = await supabase
        .from("notion_users")
        .insert(payload as never);
      if (error) {
        await finalizeLog("partial", inserted + updated, error.message);
        return { ok: false, error: error.message };
      }
      inserted += 1;
    } else {
      // Update: pisa email/name/avatar (por si cambiaron en Notion). No pisa
      // kg_person_id si el humano ya lo había mapeado — usamos el resolved
      // solo si el existing era null.
      const updatePayload: Record<string, unknown> = {
        email: u.email,
        name: u.name,
        avatar_url: u.avatar_url,
      };
      if (existingMapping == null && resolvedPersonId != null) {
        updatePayload.kg_person_id = resolvedPersonId;
      }
      const { error } = await supabase
        .from("notion_users")
        .update(updatePayload as never)
        .eq("workspace_id", workspaceId)
        .eq("notion_user_id", u.id);
      if (error) {
        await finalizeLog("partial", inserted + updated, error.message);
        return { ok: false, error: error.message };
      }
      updated += 1;
    }
  }

  await finalizeLog("ok", inserted + updated);
  revalidatePath(`/configuracion/notion/${workspaceId}/usuarios`);
  revalidatePath("/configuracion/notion");

  return {
    ok: true,
    fetched: notionUsers.length,
    persons: persons.length,
    inserted,
    updated,
    autoMatched,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// setNotionUserPersonMapping — mapping manual desde la UI
// ═══════════════════════════════════════════════════════════════════════════

export type SetMappingResult = { ok: true } | { ok: false; error: string };

export async function setNotionUserPersonMapping(
  workspaceId: string,
  notionUserId: string,
  kgPersonId: string | null,
): Promise<SetMappingResult> {
  await requireRole("superadmin");

  const supabase = await createClient();
  const { error } = await supabase
    .from("notion_users")
    .update({ kg_person_id: kgPersonId } as never)
    .eq("workspace_id", workspaceId)
    .eq("notion_user_id", notionUserId);

  if (error) return { ok: false, error: error.message };
  revalidatePath(`/configuracion/notion/${workspaceId}/usuarios`);
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// autoMatchNotionUsers — corre solo el matching por email sin refetch a Notion
// ═══════════════════════════════════════════════════════════════════════════
//
// Útil cuando cambian los emails en organization_people después de un sync
// (ej: se corrigió un typo). No pisa mappings ya definidos por el humano.

export type AutoMatchResult =
  | { ok: true; matched: number; totalUnmapped: number }
  | { ok: false; error: string };

export async function autoMatchNotionUsers(
  workspaceId: string,
): Promise<AutoMatchResult> {
  await requireRole("superadmin");

  const supabase = await createClient();

  const wsRes = await supabase
    .from("notion_workspaces")
    .select("id, organization_id")
    .eq("id", workspaceId)
    .maybeSingle();
  const ws = wsRes.data as { organization_id: string } | null;
  if (!ws) return { ok: false, error: "Workspace no encontrado." };

  const unmappedRes = await supabase
    .from("notion_users")
    .select("notion_user_id, email")
    .eq("workspace_id", workspaceId)
    .is("kg_person_id", null);
  const unmapped = (unmappedRes.data ?? []) as Array<{
    notion_user_id: string;
    email: string | null;
  }>;

  if (unmapped.length === 0) {
    return { ok: true, matched: 0, totalUnmapped: 0 };
  }

  const peopleRes = await supabase
    .from("organization_people")
    .select("id, email")
    .eq("organization_id", ws.organization_id)
    .eq("active", true);
  const personIdByEmail = new Map<string, string>();
  for (const p of (peopleRes.data ?? []) as Array<{
    id: string;
    email: string | null;
  }>) {
    const em = (p.email ?? "").trim().toLowerCase();
    if (em && !personIdByEmail.has(em)) personIdByEmail.set(em, p.id);
  }

  let matched = 0;
  for (const u of unmapped) {
    const em = (u.email ?? "").trim().toLowerCase();
    if (!em) continue;
    const pid = personIdByEmail.get(em);
    if (!pid) continue;
    const { error } = await supabase
      .from("notion_users")
      .update({ kg_person_id: pid } as never)
      .eq("workspace_id", workspaceId)
      .eq("notion_user_id", u.notion_user_id);
    if (!error) matched += 1;
  }

  revalidatePath(`/configuracion/notion/${workspaceId}/usuarios`);
  return { ok: true, matched, totalUnmapped: unmapped.length };
}

// ═══════════════════════════════════════════════════════════════════════════
// Databases — enable/disable + retrieve schema + save mapping
// ═══════════════════════════════════════════════════════════════════════════

export type SetDatabaseEnabledResult =
  | { ok: true }
  | { ok: false; error: string };

export async function setNotionDatabaseEnabled(
  databaseId: string,
  enabled: boolean,
): Promise<SetDatabaseEnabledResult> {
  await requireRole("superadmin");

  const supabase = await createClient();
  const { error } = await supabase
    .from("notion_databases")
    .update({ enabled } as never)
    .eq("id", databaseId);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/configuracion/notion");
  return { ok: true };
}

export type RetrieveSchemaResult =
  | { ok: true; schema: NotionDatabaseSchema }
  | { ok: false; error: string };

export async function retrieveNotionDatabaseSchema(
  databaseId: string,
): Promise<RetrieveSchemaResult> {
  await requireRole("superadmin");

  const supabase = await createClient();

  // Necesitamos el notion_id de la DB y el token del workspace. Un join
  // sería mas elegante pero postgrest-js no da un join limpio para esto —
  // dos queries a mano es igual de rápido y más simple de leer.
  const dbRes = await supabase
    .from("notion_databases")
    .select("id, notion_id, workspace_id")
    .eq("id", databaseId)
    .maybeSingle();
  const db = dbRes.data as
    | { id: string; notion_id: string; workspace_id: string }
    | null;
  if (!db) return { ok: false, error: "Database no encontrada." };

  const wsRes = await supabase
    .from("notion_workspaces")
    .select("secret_token")
    .eq("id", db.workspace_id)
    .maybeSingle();
  const ws = wsRes.data as { secret_token: string } | null;
  if (!ws) return { ok: false, error: "Workspace no encontrado." };

  try {
    const schema = await apiRetrieveDatabase(ws.secret_token, db.notion_id);
    return { ok: true, schema };
  } catch (e) {
    return { ok: false, error: notionErrorMessage(e) };
  }
}

export type SaveMappingResult =
  | { ok: true }
  | { ok: false; error: string };

export async function saveNotionDatabaseMapping(
  databaseId: string,
  map: NotionPropertyMap,
): Promise<SaveMappingResult> {
  await requireRole("superadmin");

  if (!map.title_prop) {
    return { ok: false, error: "Falta 'title_prop' — es obligatorio." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("notion_databases")
    .update({ property_map: serializePropertyMap(map) } as never)
    .eq("id", databaseId);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/configuracion/notion");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// syncNotionDatabase — trae pages de una DB y los upserta como internal_projects
// ═══════════════════════════════════════════════════════════════════════════
//
// Wrapper de la UI: mismos permisos que el resto de la config Notion
// (superadmin), full sync (sin incremental), y revalida los paths afectados.
// La lógica vive en `src/lib/notion/sync-runner.ts` para compartirla con el
// cron.

export type SyncDatabaseResult = SyncDatabaseRunResult;

export async function syncNotionDatabase(
  databaseId: string,
): Promise<SyncDatabaseResult> {
  await requireRole("superadmin");
  const supabase = await createClient();
  const res = await runNotionDatabaseSync(databaseId, supabase);
  revalidatePath("/operaciones/proyectos");
  revalidatePath("/configuracion/notion");
  return res;
}

// ═══════════════════════════════════════════════════════════════════════════
// syncAllEnabledNotionDatabases — orquestador para el botón de Ops
// ═══════════════════════════════════════════════════════════════════════════

export type SyncAllResult = SyncAllRunResult;

export async function syncAllEnabledNotionDatabases(): Promise<SyncAllResult> {
  await requireRole("superadmin");
  const supabase = await createClient();
  const res = await runAllEnabledNotionDatabases(supabase);
  revalidatePath("/operaciones/proyectos");
  revalidatePath("/configuracion/notion");
  return res;
}

// ═══════════════════════════════════════════════════════════════════════════
// postNotionComment (4e) — escribe un comment en Notion y lo cachea local
// ═══════════════════════════════════════════════════════════════════════════
//
// Autoría: los comentarios creados vía internal integration aparecen en
// Notion firmados por el bot. Prefijamos el content con "{KG name} escribió:"
// para preservar la firma humana visible.
//
// Mentions: solo se aceptan `notion_user_id`s que (a) existen en el cache
// `notion_users` del workspace del proyecto y (b) están mapeados a una
// `organization_person`. Filtramos server-side: la UI puede mandar cualquier
// id, pero acá solo dejamos pasar los mapeados (defensa contra abuso).
//
// Cache local: después del POST exitoso a Notion, insertamos una fila en
// `internal_project_notion_comments` para que aparezca inmediato en la
// ficha sin esperar al próximo sync. `notion_user_id` queda null porque
// el "autor" técnico es el bot — la persona real está en el prefijo.

export type PostNotionCommentResult =
  | { ok: true; commentId: string }
  | { ok: false; error: string };

export async function postNotionComment(
  projectId: string,
  contentPlain: string,
  mentionedNotionUserIds: readonly string[],
): Promise<PostNotionCommentResult> {
  const profile = await requireRole(
    "superadmin",
    "admin",
    "coordinador",
    "operador",
  );

  const trimmed = contentPlain.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "El comentario no puede estar vacío." };
  }

  const supabase = await createClient();

  const projRes = await supabase
    .from("internal_projects")
    .select("id, organization_id, notion_page_id, notion_workspace_id")
    .eq("id", projectId)
    .maybeSingle();
  const project = projRes.data as
    | {
        id: string;
        organization_id: string;
        notion_page_id: string | null;
        notion_workspace_id: string | null;
      }
    | null;
  if (!project) {
    return { ok: false, error: "Proyecto no encontrado." };
  }
  if (!project.notion_page_id || !project.notion_workspace_id) {
    return {
      ok: false,
      error: "Este proyecto no está vinculado a una page de Notion.",
    };
  }

  const wsRes = await supabase
    .from("notion_workspaces")
    .select("secret_token, enabled")
    .eq("id", project.notion_workspace_id)
    .maybeSingle();
  const ws = wsRes.data as
    | { secret_token: string; enabled: boolean }
    | null;
  if (!ws) return { ok: false, error: "Workspace de Notion no encontrado." };
  if (!ws.enabled) {
    return { ok: false, error: "El workspace de Notion está deshabilitado." };
  }

  // Validar mentions server-side: solo dejamos pasar notion_users mapeados
  // a organization_people. Devuelve el subset válido (en orden estable
  // por notion_user_id — el orden visual en el mensaje refleja este subset).
  let validMentions: Array<{ id: string; name: string | null }> = [];
  if (mentionedNotionUserIds.length > 0) {
    const uniqueIds = Array.from(new Set(mentionedNotionUserIds));
    const usersRes = await supabase
      .from("notion_users")
      .select("notion_user_id, name")
      .eq("workspace_id", project.notion_workspace_id)
      .in("notion_user_id", uniqueIds)
      .not("kg_person_id", "is", null);
    const rows = (usersRes.data ?? []) as Array<{
      notion_user_id: string;
      name: string | null;
    }>;
    validMentions = rows.map((r) => ({ id: r.notion_user_id, name: r.name }));
  }

  // Construir rich_text: prefijo de autoría KG + contenido + "cc: @a @b"
  const authorLabel =
    profile.fullName?.trim() || profile.email || "Usuario Kingrow";
  const prefix = `${authorLabel} escribió: `;
  const richText: NotionRichTextBlock[] = [
    { type: "text", text: { content: prefix } },
    { type: "text", text: { content: trimmed } },
  ];
  if (validMentions.length > 0) {
    richText.push({ type: "text", text: { content: " · cc: " } });
    validMentions.forEach((m, i) => {
      if (i > 0) richText.push({ type: "text", text: { content: " " } });
      richText.push({
        type: "mention",
        mention: { user: { id: m.id } },
      });
    });
  }

  let created: Awaited<ReturnType<typeof apiPostPageComment>>;
  try {
    created = await apiPostPageComment(
      ws.secret_token,
      project.notion_page_id,
      richText,
    );
  } catch (e) {
    return { ok: false, error: notionErrorMessage(e) };
  }

  // Cache local — armamos el content_plain que representa lo que Notion
  // recibirá (mentions renderizadas como "@Nombre"). Errores acá no rompen
  // la operación: el próximo sync trae el comentario de todos modos.
  const mentionsSuffix =
    validMentions.length > 0
      ? ` · cc: ${validMentions.map((m) => `@${m.name ?? "user"}`).join(" ")}`
      : "";
  const cachedPlain = `${prefix}${trimmed}${mentionsSuffix}`;

  await supabase.from("internal_project_notion_comments").insert({
    organization_id: project.organization_id,
    internal_project_id: project.id,
    notion_comment_id: created.id,
    notion_user_id: null,
    content_plain: cachedPlain,
    created_time: created.created_time,
    updated_time: created.last_edited_time,
    synced_at: new Date().toISOString(),
  } as never);

  revalidatePath(`/operaciones/proyectos/${projectId}`);
  return { ok: true, commentId: created.id };
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
