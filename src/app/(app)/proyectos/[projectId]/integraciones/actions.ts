"use server";

import { revalidatePath } from "next/cache";

import { isValidProviderId } from "@/lib/integrations/types";
import { createServiceClient } from "@/lib/supabase/service";
import { requireCanEditProject } from "@/lib/supabase/auth";

export type IntegrationActionState = { ok: true } | { error: string } | null;

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function bump(projectId: string): void {
  revalidatePath(`/proyectos/${projectId}/integraciones`);
}

/**
 * Connect (or re-connect) an integration.
 *
 * Writes go through the service-role client because:
 *   1. `project_secrets` has RLS enabled with NO policies — only service-role
 *      can insert into it.
 *   2. `project_integrations` is RLS-writable by admins of the project, but
 *      using the same client for both keeps the action atomic-feeling and
 *      avoids needing two Supabase clients.
 *
 * No real OAuth — the secret is stored as-is. Phase 7 is stub; the actual
 * sync to Meta/Google/TikTok etc. lands later.
 */
export async function connectIntegration(
  projectId: string,
  _prev: IntegrationActionState,
  formData: FormData,
): Promise<IntegrationActionState> {
  await requireCanEditProject(projectId);

  const provider = str(formData, "provider");
  const accountId = str(formData, "account_id");
  const secret = str(formData, "secret");

  if (!isValidProviderId(provider)) return { error: "Proveedor inválido." };
  if (!accountId) return { error: "El identificador de cuenta es obligatorio." };
  if (!secret) return { error: "La credencial es obligatoria." };

  const service = createServiceClient();

  // postgrest never-inference workaround on every payload below.
  const integrationPayload = {
    project_id: projectId,
    provider,
    connected: true,
    account_id: accountId,
    status: "connected",
    last_sync: null,
    config: {},
  } as never;

  const { error: integrationError } = await service
    .from("project_integrations")
    .upsert(integrationPayload, { onConflict: "project_id,provider" });

  if (integrationError) return { error: integrationError.message };

  const secretPayload = {
    project_id: projectId,
    provider,
    secret,
  } as never;

  const { error: secretError } = await service
    .from("project_secrets")
    .upsert(secretPayload, { onConflict: "project_id,provider" });

  if (secretError) {
    // Best-effort rollback: revert the integration row so the UI doesn't lie
    // about being connected when the secret never landed.
    const revertPayload = {
      connected: false,
      account_id: null,
      status: "disconnected",
    } as never;
    await service
      .from("project_integrations")
      .update(revertPayload)
      .eq("project_id", projectId)
      .eq("provider", provider);
    return { error: `No se guardó la credencial: ${secretError.message}` };
  }

  bump(projectId);
  return { ok: true };
}

/**
 * Replace the secret for an already-connected integration. Account id stays.
 */
export async function rotateSecret(
  projectId: string,
  _prev: IntegrationActionState,
  formData: FormData,
): Promise<IntegrationActionState> {
  await requireCanEditProject(projectId);

  const provider = str(formData, "provider");
  const secret = str(formData, "secret");

  if (!isValidProviderId(provider)) return { error: "Proveedor inválido." };
  if (!secret) return { error: "La credencial es obligatoria." };

  const service = createServiceClient();
  const payload = { project_id: projectId, provider, secret } as never;
  const { error } = await service
    .from("project_secrets")
    .upsert(payload, { onConflict: "project_id,provider" });

  if (error) return { error: error.message };

  bump(projectId);
  return { ok: true };
}

/**
 * Disconnect: drop the secret row and mark the integration as disconnected.
 * The integration row itself stays so a future re-connect keeps history /
 * config; only `connected`, `account_id`, and `status` get reset.
 */
export async function disconnectIntegration(
  projectId: string,
  provider: string,
): Promise<void> {
  await requireCanEditProject(projectId);
  if (!isValidProviderId(provider)) return;

  const service = createServiceClient();

  await service
    .from("project_secrets")
    .delete()
    .eq("project_id", projectId)
    .eq("provider", provider);

  const updatePayload = {
    connected: false,
    account_id: null,
    status: "disconnected",
    last_sync: null,
  } as never;
  await service
    .from("project_integrations")
    .update(updatePayload)
    .eq("project_id", projectId)
    .eq("provider", provider);

  bump(projectId);
}
