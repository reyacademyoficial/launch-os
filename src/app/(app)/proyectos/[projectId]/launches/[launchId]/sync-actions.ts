"use server";

import { revalidatePath } from "next/cache";

import { fetchGhlUsers } from "@/lib/integrations/ghl";
import { syncLaunch, type SyncProviderId } from "@/lib/integrations/sync";
import {
  requireCanEditLaunchesIn,
  requireSessionProfile,
} from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Server Actions de integraciones para un launch puntual.
 *
 * Permission gate común: `requireCanEditLaunchesIn(projectId)` — admin /
 * operador / superadmin del proyecto pasan. Coordinador y cliente no.
 *
 * Por qué todos pasan por service-role: leen/escriben `launch_secrets` (RLS
 * sin policies) o `launches.integration_config` (RLS escritura por launch).
 * El gate de permiso se aplica en la action ANTES de instanciar el service
 * client.
 */

export type SyncActionState = { ok: true } | { error: string } | null;

// Cast laxo para queries contra tablas que el Database type generado todavía
// no conoce (team_members, ghl_user_mappings). Mismo workaround que usan los
// archivos de integraciones.
/* eslint-disable @typescript-eslint/no-explicit-any */
type LooseClient = { from: (name: string) => any };
function loose(svc: unknown): LooseClient {
  return svc as LooseClient;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ─── triggerSync ──────────────────────────────────────────────────────────

export interface TriggerSyncResult {
  ok: boolean;
  runId: string;
  status: string;
  rowsWritten: number;
  errorMessage: string | null;
}

/**
 * Dispara una corrida de sync para `(launchId, provider)`. El botón en la
 * UI llama esto. Devuelve el resultado para que la UI muestre toast/error;
 * además, Realtime sobre `launch_daily_ads` actualiza KPIs/chart al instante.
 */
export async function triggerSync(
  projectId: string,
  launchId: string,
  provider: SyncProviderId,
): Promise<TriggerSyncResult> {
  const profile = await requireCanEditLaunchesIn(projectId);

  const result = await syncLaunch({
    launchId,
    provider,
    triggeredBy: profile.id,
  });

  revalidatePath(`/proyectos/${projectId}/launches/${launchId}`);

  return {
    ok: result.status === "success",
    runId: result.runId,
    status: result.status,
    rowsWritten: result.rowsWritten,
    errorMessage: result.errorMessage,
  };
}

// ─── saveIntegrationConfig ────────────────────────────────────────────────

interface AdsConfigPayload {
  /** Shape multi-account: 1+ cuentas, cada una con sus campañas. */
  ad_accounts: Array<{ ad_account_id: string; campaign_ids: string[] }>;
}
interface GhlConfigPayload {
  location_id: string;
  default_country: string;
}
interface SendflowConfigPayload {
  release_ids: string[];
}

/**
 * Guarda la config de un provider en `launches.integration_config`. Hace
 * merge con la config existente (no pisa la de otros providers).
 *
 * El shape del payload depende del provider:
 *   - meta / google / tiktok → ad_account_id + campaign_ids (≥1).
 *   - ghl → location_id + default_country.
 */
export async function saveIntegrationConfig(
  projectId: string,
  launchId: string,
  provider: SyncProviderId,
  _prev: SyncActionState,
  formData: FormData,
): Promise<SyncActionState> {
  await requireCanEditLaunchesIn(projectId);

  let payload: AdsConfigPayload | GhlConfigPayload | SendflowConfigPayload;

  if (provider === "sendflow") {
    // Release IDs separados por coma o espacio (mismo UX que campaign_ids de
    // Meta). Trimeamos cada uno; descartamos vacíos. Mínimo 1.
    const raw = String(formData.get("release_ids_text") ?? "").trim();
    if (!raw) {
      return {
        error: "Pegá al menos un Release ID (separá con coma o espacio si hay varios).",
      };
    }
    const releaseIds = raw
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (releaseIds.length === 0) {
      return { error: "No reconocí ningún Release ID válido — revisalos." };
    }
    // Defensa: duplicados explícitos confunden y se sumarían dos veces. Dedupe
    // preservando orden de aparición.
    const seen = new Set<string>();
    const uniq: string[] = [];
    for (const id of releaseIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      uniq.push(id);
    }
    payload = { release_ids: uniq };
  } else if (provider === "ghl") {
    const locationId = String(formData.get("location_id") ?? "").trim();
    if (!locationId) {
      return { error: "Tenés que ingresar el Location ID del subaccount." };
    }
    const defaultCountry =
      String(formData.get("default_country") ?? "AR").trim() || "AR";
    payload = { location_id: locationId, default_country: defaultCountry };
  } else {
    // Multi-account: la UI envía un JSON serializado con las entradas. Cada
    // entrada es { ad_account_id, campaign_ids } y necesitamos al menos una
    // con campañas válidas.
    const accountsJson = String(formData.get("ad_accounts_json") ?? "").trim();
    if (!accountsJson) {
      return {
        error: "Configurá al menos una cuenta publicitaria con sus campañas.",
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(accountsJson);
    } catch {
      return { error: "Config malformada — recargá el modal y volvé a guardar." };
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return {
        error: "Agregá al menos una cuenta publicitaria con sus campañas.",
      };
    }

    const accounts: Array<{ ad_account_id: string; campaign_ids: string[] }> = [];
    for (let i = 0; i < parsed.length; i++) {
      const entry = parsed[i];
      if (entry === null || typeof entry !== "object") continue;
      const rec = entry as Record<string, unknown>;
      const adAccountId =
        typeof rec.ad_account_id === "string" ? rec.ad_account_id.trim() : "";
      const campaignIds = Array.isArray(rec.campaign_ids)
        ? rec.campaign_ids
            .filter((c): c is string => typeof c === "string")
            .map((c) => c.trim())
            .filter((c) => c.length > 0)
        : [];

      if (!adAccountId) {
        return { error: `Cuenta ${i + 1}: falta el Ad Account ID.` };
      }
      if (provider === "meta" && !adAccountId.startsWith("act_")) {
        return {
          error: `Cuenta ${i + 1}: el Ad Account ID de Meta arranca con 'act_'.`,
        };
      }
      if (campaignIds.length === 0) {
        return {
          error: `Cuenta ${i + 1} (${adAccountId}): asociá al menos una campaña.`,
        };
      }
      accounts.push({ ad_account_id: adAccountId, campaign_ids: campaignIds });
    }

    if (accounts.length === 0) {
      return {
        error: "No reconocí ninguna cuenta válida — revisá los campos.",
      };
    }

    // Defensa: ad accounts duplicados en el mismo launch no tienen sentido
    // (las campañas del segundo se agregarían al primero y se vuelve confuso).
    const seen = new Set<string>();
    for (const a of accounts) {
      if (seen.has(a.ad_account_id)) {
        return {
          error: `Cuenta ${a.ad_account_id} aparece dos veces — unificá sus campañas en una sola entrada.`,
        };
      }
      seen.add(a.ad_account_id);
    }

    payload = { ad_accounts: accounts };
  }

  const service = createServiceClient();

  // Merge con la config existente (otros providers no se pisan)
  const current = await service
    .from("launches")
    .select("integration_config")
    .eq("id", launchId)
    .maybeSingle();
  const existing = ((current.data as { integration_config: unknown } | null)
    ?.integration_config ?? {}) as Record<string, unknown>;

  const next = { ...existing, [provider]: payload };

  const updatePayload = { integration_config: next } as never;
  const { error } = await service
    .from("launches")
    .update(updatePayload)
    .eq("id", launchId);
  if (error) return { error: error.message };

  revalidatePath(`/proyectos/${projectId}/launches/${launchId}`);
  return { ok: true };
}

// ─── saveLaunchSecret ─────────────────────────────────────────────────────

/**
 * Upsert del token en `launch_secrets`. Solo service-role lo escribe — la
 * tabla está blindada. El input viene como text del form; nunca llega al
 * cliente (la UI lo limpia post-submit).
 */
export async function saveLaunchSecret(
  projectId: string,
  launchId: string,
  provider: SyncProviderId,
  _prev: SyncActionState,
  formData: FormData,
): Promise<SyncActionState> {
  await requireCanEditLaunchesIn(projectId);

  const secret = String(formData.get("secret") ?? "").trim();
  if (!secret) return { error: "Pegá el access token antes de guardar." };

  const service = createServiceClient();
  const payload = {
    launch_id: launchId,
    provider,
    secret,
  } as never;

  const { error } = await service
    .from("launch_secrets")
    .upsert(payload, { onConflict: "launch_id,provider" });
  if (error) return { error: error.message };

  revalidatePath(`/proyectos/${projectId}/launches/${launchId}`);
  return { ok: true };
}

// ─── deleteLaunchSecret ───────────────────────────────────────────────────

/**
 * "Desconectar" un provider: borra el token. La config queda (para que sea
 * fácil reconectar pegando un token nuevo). El estado deriva de los runs —
 * sin secret, el próximo sync va a fallar con config_missing.
 */
export async function deleteLaunchSecret(
  projectId: string,
  launchId: string,
  provider: SyncProviderId,
): Promise<void> {
  await requireCanEditLaunchesIn(projectId);

  const service = createServiceClient();
  await service
    .from("launch_secrets")
    .delete()
    .eq("launch_id", launchId)
    .eq("provider", provider);

  revalidatePath(`/proyectos/${projectId}/launches/${launchId}`);
}

// ─── copyConnectionsFromLaunch ────────────────────────────────────────────

/**
 * Copia integration_config + launch_secrets de `sourceLaunchId` al `targetLaunchId`
 * (ambos en el mismo proyecto). Pisa la config y los secrets actuales del
 * target. Pensado para llamarse desde el modal de crear launch, después de
 * crear el target.
 */
export async function copyConnectionsFromLaunch(
  projectId: string,
  sourceLaunchId: string,
  targetLaunchId: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireCanEditLaunchesIn(projectId);
  await requireSessionProfile(); // ya cubierto por el require de arriba, redundante por defensa

  const service = createServiceClient();

  // 1) Verificar que ambos launches pertenecen al projectId — defensa contra URL tampering
  const sourceRes = await service
    .from("launches")
    .select("project_id, integration_config")
    .eq("id", sourceLaunchId)
    .maybeSingle();
  const source = sourceRes.data as
    | { project_id: string; integration_config: unknown }
    | null;
  if (!source) return { ok: false, error: "Lanzamiento origen no encontrado" };
  if (source.project_id !== projectId) {
    return { ok: false, error: "El lanzamiento origen pertenece a otro proyecto" };
  }

  const targetRes = await service
    .from("launches")
    .select("project_id")
    .eq("id", targetLaunchId)
    .maybeSingle();
  const target = targetRes.data as { project_id: string } | null;
  if (!target) return { ok: false, error: "Lanzamiento destino no encontrado" };
  if (target.project_id !== projectId) {
    return { ok: false, error: "El lanzamiento destino pertenece a otro proyecto" };
  }

  // 2) Copiar config
  const copyConfigPayload = {
    integration_config: source.integration_config ?? {},
  } as never;
  const cfgUpdate = await service
    .from("launches")
    .update(copyConfigPayload)
    .eq("id", targetLaunchId);
  if (cfgUpdate.error) return { ok: false, error: cfgUpdate.error.message };

  // 3) Copiar secrets (uno por provider)
  const secretsRes = await service
    .from("launch_secrets")
    .select("provider, secret")
    .eq("launch_id", sourceLaunchId);
  const secrets = (secretsRes.data ?? []) as Array<{ provider: string; secret: string }>;

  if (secrets.length > 0) {
    const newRows = secrets.map((s) => ({
      launch_id: targetLaunchId,
      provider: s.provider,
      secret: s.secret,
    }));
    const upsert = await service
      .from("launch_secrets")
      .upsert(newRows as never, { onConflict: "launch_id,provider" });
    if (upsert.error) return { ok: false, error: upsert.error.message };
  }

  revalidatePath(`/proyectos/${projectId}/launches/${targetLaunchId}`);
  return { ok: true };
}

// ─── GHL user mappings ────────────────────────────────────────────────────

export interface GhlUserMappingsData {
  /** Users que devuelve GHL para el location del launch. */
  ghlUsers: ReadonlyArray<{ id: string; name: string }>;
  /** Team members del proyecto (lo que va al lado del dropdown). */
  teamMembers: ReadonlyArray<{ id: string; name: string }>;
  /** Mappings actuales: ghl_user_id → team_member_id. */
  currentMappings: ReadonlyArray<{ ghlUserId: string; teamMemberId: string }>;
}

/**
 * Lista los GHL users del location del launch + los team_members del proyecto
 * + los mappings ya guardados. Esto es lo que el modal necesita para armar la
 * tabla de "GHL user → team_member".
 *
 * Si falta config (location_id o token) devuelve `{ error }` para que la UI
 * muestre el cartel correspondiente.
 */
export async function listGhlUserMappings(
  projectId: string,
  launchId: string,
): Promise<{ data: GhlUserMappingsData } | { error: string }> {
  await requireCanEditLaunchesIn(projectId);
  const service = createServiceClient();

  // 1) location_id del launch
  const launchRes = await service
    .from("launches")
    .select("integration_config")
    .eq("id", launchId)
    .maybeSingle();
  const cfg = ((launchRes.data as { integration_config: unknown } | null)
    ?.integration_config ?? {}) as Record<string, unknown>;
  const ghlCfg = (cfg.ghl ?? {}) as Record<string, unknown>;
  const locationId =
    typeof ghlCfg.location_id === "string" ? ghlCfg.location_id : null;
  if (!locationId) {
    return { error: "Configurá el Location ID de GHL antes de mapear vendedores." };
  }

  // 2) token
  const secretRes = await service
    .from("launch_secrets")
    .select("secret")
    .eq("launch_id", launchId)
    .eq("provider", "ghl")
    .maybeSingle();
  const token = (secretRes.data as { secret: string } | null)?.secret ?? null;
  if (!token) {
    return { error: "Falta el Private Integration Token de GHL." };
  }

  // 3) organization_id del proyecto — team_members es org-scope post 0124,
  //    así que el filtro de miembros pasa por org, no por proyecto.
  const projectRes = await service
    .from("projects")
    .select("organization_id")
    .eq("id", projectId)
    .maybeSingle();
  const projectOrgId =
    (projectRes.data as { organization_id: string } | null)?.organization_id ??
    null;
  if (!projectOrgId) {
    return { error: "No se pudo resolver la organización del proyecto." };
  }

  // 4) GHL users + team_members (org-wide) + mappings en paralelo
  const [ghlUsersResult, teamRes, mappingsRes] = await Promise.all([
    fetchGhlUsers(token, locationId),
    loose(service)
      .from("team_members")
      .select("id, name, active")
      .eq("organization_id", projectOrgId)
      .eq("active", true)
      .order("name"),
    loose(service)
      .from("ghl_user_mappings")
      .select("ghl_user_id, team_member_id")
      .eq("project_id", projectId),
  ]);

  if (!ghlUsersResult.ok) {
    return {
      error: `GHL: ${ghlUsersResult.message}. ${
        ghlUsersResult.kind === "token_invalid"
          ? "El PIT puede no tener scope 'View Users'."
          : "Reintentá en unos minutos."
      }`,
    };
  }

  const ghlUsers = ghlUsersResult.rows.map((u) => ({ id: u.id, name: u.name }));
  const teamMembers = ((teamRes.data ?? []) as Array<{ id: string; name: string }>).map(
    (t) => ({ id: t.id, name: t.name }),
  );
  const currentMappings = (
    (mappingsRes.data ?? []) as Array<{ ghl_user_id: string; team_member_id: string }>
  ).map((m) => ({ ghlUserId: m.ghl_user_id, teamMemberId: m.team_member_id }));

  return { data: { ghlUsers, teamMembers, currentMappings } };
}

/**
 * Sobrescribe los mappings del proyecto con la lista recibida. Las entries
 * con teamMemberId vacío se eliminan; el resto se upsertea. Atómico desde el
 * punto de vista del usuario (no exponemos cada upsert).
 */
export async function saveGhlUserMappings(
  projectId: string,
  launchId: string,
  mappings: ReadonlyArray<{ ghlUserId: string; teamMemberId: string | null }>,
): Promise<{ ok: boolean; error?: string }> {
  await requireCanEditLaunchesIn(projectId);
  const service = createServiceClient();

  const toDelete = mappings.filter((m) => !m.teamMemberId);
  const toUpsert = mappings.filter(
    (m): m is { ghlUserId: string; teamMemberId: string } => Boolean(m.teamMemberId),
  );

  if (toDelete.length > 0) {
    const ghlIds = toDelete.map((m) => m.ghlUserId);
    const del = await loose(service)
      .from("ghl_user_mappings")
      .delete()
      .eq("project_id", projectId)
      .in("ghl_user_id", ghlIds);
    if (del.error) return { ok: false, error: del.error.message };
  }

  if (toUpsert.length > 0) {
    const payload = toUpsert.map((m) => ({
      project_id: projectId,
      ghl_user_id: m.ghlUserId,
      team_member_id: m.teamMemberId,
    }));
    const up = await loose(service)
      .from("ghl_user_mappings")
      .upsert(payload, { onConflict: "project_id,ghl_user_id" });
    if (up.error) return { ok: false, error: up.error.message };
  }

  revalidatePath(`/proyectos/${projectId}/launches/${launchId}`);
  return { ok: true };
}
