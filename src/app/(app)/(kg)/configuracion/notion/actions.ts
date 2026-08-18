"use server";

import { revalidatePath } from "next/cache";

import {
  listDatabases as apiListDatabases,
  NotionApiError,
  whoAmI as apiWhoAmI,
} from "@/lib/notion/client";
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
