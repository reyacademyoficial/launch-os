"use server";

import { revalidatePath } from "next/cache";

import {
  listDatabases as apiListDatabases,
  listUsers as apiListUsers,
  NotionApiError,
  queryDatabase as apiQueryDatabase,
  retrieveDatabase as apiRetrieveDatabase,
  whoAmI as apiWhoAmI,
  type NotionDatabaseSchema,
} from "@/lib/notion/client";
import {
  mapNotionPageToInternalProject,
  type InternalProjectUpsertPayload,
} from "@/lib/notion/map-page-to-project";
import {
  parsePropertyMap,
  serializePropertyMap,
  type NotionPropertyMap,
} from "@/lib/notion/property-map";
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
  // y ya conocidas (UPDATE solo del nombre para preservar enabled + mapping
  // configurado por el usuario). Un upsert masivo pisaría los defaults, por
  // eso lo separamos en dos operaciones explícitas.
  const newOnes = dbs.filter((d) => !existing.has(d.id));
  const existingOnes = dbs.filter((d) => existing.has(d.id));

  if (newOnes.length > 0) {
    const { error: insErr } = await supabase
      .from("notion_databases")
      .insert(
        newOnes.map((d) => ({
          workspace_id: workspaceId,
          notion_id: d.id,
          name: d.title_plain,
        })) as never,
      );
    if (insErr) return { ok: false, error: insErr.message };
  }

  // Actualizar nombre por si el usuario renombró en Notion. Iteramos:
  // pocas DBs típicas (< 20 por workspace), no vale la pena batch update.
  for (const d of existingOnes) {
    await supabase
      .from("notion_databases")
      .update({ name: d.title_plain } as never)
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

export type SyncDatabaseResult =
  | {
      ok: true;
      fetched: number;
      upserted: number;
      skippedNoTitle: number;
    }
  | { ok: false; error: string };

export async function syncNotionDatabase(
  databaseId: string,
): Promise<SyncDatabaseResult> {
  await requireRole("superadmin");

  const supabase = await createClient();

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

  // 3) Fetch pages de Notion
  let pages: Awaited<ReturnType<typeof apiQueryDatabase>>;
  try {
    pages = await apiQueryDatabase(ws.secret_token, db.notion_id);
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
    payloads.push(mapped.payload);
  }

  // 6) Upsert por notion_page_id — postgrest onConflict soporta ese campo
  //    porque tiene UNIQUE parcial (0132). Los projects nativos KG
  //    (notion_page_id NULL) NO se tocan.
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

  await finalizeLog("ok", upserted);
  revalidatePath("/operaciones/proyectos");
  revalidatePath("/configuracion/notion");

  return {
    ok: true,
    fetched: pages.length,
    upserted,
    skippedNoTitle,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// syncAllEnabledNotionDatabases — orquestador para el botón de Ops
// ═══════════════════════════════════════════════════════════════════════════

export type SyncAllResult = {
  workspacesRun: number;
  databasesRun: number;
  totalUpserted: number;
  errors: ReadonlyArray<{ databaseId: string; error: string }>;
};

export async function syncAllEnabledNotionDatabases(): Promise<SyncAllResult> {
  await requireRole("superadmin");

  const supabase = await createClient();
  // Traigo todas las DBs enabled cuyo workspace esté también enabled.
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
  for (const row of activeRows) {
    const res = await syncNotionDatabase(row.id);
    if (res.ok) totalUpserted += res.upserted;
    else errors.push({ databaseId: row.id, error: res.error });
  }

  revalidatePath("/operaciones/proyectos");
  return {
    workspacesRun,
    databasesRun: activeRows.length,
    totalUpserted,
    errors,
  };
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
