"use server";

import { revalidatePath } from "next/cache";

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
 * operador / superadmin del proyecto pasan. Analista y cliente no.
 *
 * Por qué todos pasan por service-role: leen/escriben `launch_secrets` (RLS
 * sin policies) o `launches.integration_config` (RLS escritura por launch).
 * El gate de permiso se aplica en la action ANTES de instanciar el service
 * client.
 */

export type SyncActionState = { ok: true } | { error: string } | null;

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
  ad_account_id: string;
  campaign_ids: string[];
}
interface GhlConfigPayload {
  location_id: string;
  default_country: string;
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

  let payload: AdsConfigPayload | GhlConfigPayload;

  if (provider === "ghl") {
    const locationId = String(formData.get("location_id") ?? "").trim();
    if (!locationId) {
      return { error: "Tenés que ingresar el Location ID del subaccount." };
    }
    const defaultCountry =
      String(formData.get("default_country") ?? "AR").trim() || "AR";
    payload = { location_id: locationId, default_country: defaultCountry };
  } else {
    const adAccountId = String(formData.get("ad_account_id") ?? "").trim();
    const campaignIdsRaw = String(formData.get("campaign_ids") ?? "").trim();

    if (!adAccountId) return { error: "Tenés que ingresar el Ad Account ID." };
    if (provider === "meta" && !adAccountId.startsWith("act_")) {
      return {
        error:
          "El Ad Account ID de Meta arranca con 'act_'. Revisalo (sale del Business Manager).",
      };
    }

    const campaignIds = campaignIdsRaw
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (campaignIds.length === 0) {
      return {
        error:
          "Asociá al menos una campaña — el sync filtra por campañas para no mezclar gastos.",
      };
    }

    payload = { ad_account_id: adAccountId, campaign_ids: campaignIds };
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
