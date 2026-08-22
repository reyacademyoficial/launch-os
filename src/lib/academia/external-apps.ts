import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * external_apps — apps externas asociadas a un proyecto propio (migración
 * 0153). Ver docs/kingrow-academia-plan.md Fase G + docs/INTEGRATIONS_NITRO_APP.md.
 *
 * Los tipos son locales hasta que el codegen de supabase incluya la tabla.
 * Cast `as unknown as never` en payloads para esquivar el "never inference"
 * de postgrest-js (patrón consistente con modules.ts / systems.ts).
 */

export type ExternalAppAuthStrategy =
  | "jwt"
  | "oauth2"
  | "shared_secret"
  | "magic_link";

/**
 * Config que vive en `external_apps.config` (jsonb). Todas las claves son
 * opcionales — cada `auth_strategy` usa un subset. Documentado en la
 * migración 0153 y en docs/INTEGRATIONS_NITRO_APP.md.
 */
export interface ExternalAppConfig {
  /** Shared secret usado para HMAC/JWT signing. */
  readonly secret?: string;
  /** Endpoint del backend para magic_link (llamado con { email }). */
  readonly magic_link_endpoint?: string;
  /** Nombre del query/hash param donde va el token. Default 'token'. */
  readonly token_param?: string;
  /** 'query' (?token=…) o 'hash' (#token=…). Default 'query'. */
  readonly token_placement?: "query" | "hash";
  /** JWT `iss` claim (opcional). */
  readonly issuer?: string;
  /** JWT `aud` claim (opcional). */
  readonly audience?: string;
  /** Segundos de validez del token. Default 300 (5min). */
  readonly expires_in_seconds?: number;
}

export interface ExternalAppRow {
  id: string;
  project_id: string;
  name: string;
  base_url: string;
  auth_strategy: ExternalAppAuthStrategy;
  config: ExternalAppConfig;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateExternalAppInput {
  project_id: string;
  name: string;
  base_url: string;
  auth_strategy: ExternalAppAuthStrategy;
  config?: ExternalAppConfig;
  active?: boolean;
}

export interface UpdateExternalAppInput {
  name?: string;
  base_url?: string;
  auth_strategy?: ExternalAppAuthStrategy;
  config?: ExternalAppConfig;
  active?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Reads
// ═══════════════════════════════════════════════════════════════════════════

export async function listExternalApps(
  projectId: string,
): Promise<ExternalAppRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("external_apps")
    .select("*")
    .eq("project_id", projectId)
    .order("active", { ascending: false })
    .order("name", { ascending: true });
  return (data ?? []) as unknown as ExternalAppRow[];
}

/**
 * Trae todas las external_apps visibles al caller. Útil para el CRUD cuando
 * no hay project scope explícito (RLS filtra por has_project_access).
 */
export async function listAllExternalApps(): Promise<ExternalAppRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("external_apps")
    .select("*")
    .order("active", { ascending: false })
    .order("name", { ascending: true });
  return (data ?? []) as unknown as ExternalAppRow[];
}

export async function getExternalApp(
  id: string,
): Promise<ExternalAppRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("external_apps")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data as unknown as ExternalAppRow | null) ?? null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Writes
// ═══════════════════════════════════════════════════════════════════════════

export async function createExternalApp(
  input: CreateExternalAppInput,
): Promise<ExternalAppRow> {
  const supabase = await createClient();
  const payload = {
    project_id: input.project_id,
    name: input.name,
    base_url: input.base_url,
    auth_strategy: input.auth_strategy,
    config: input.config ?? {},
    active: input.active ?? true,
  } as unknown as never;

  const { data, error } = await supabase
    .from("external_apps")
    .insert(payload)
    .select("*")
    .single();

  if (error) throw error;
  return data as unknown as ExternalAppRow;
}

export async function updateExternalApp(
  id: string,
  input: UpdateExternalAppInput,
): Promise<ExternalAppRow> {
  const supabase = await createClient();
  const payload = {
    ...(input.name !== undefined && { name: input.name }),
    ...(input.base_url !== undefined && { base_url: input.base_url }),
    ...(input.auth_strategy !== undefined && {
      auth_strategy: input.auth_strategy,
    }),
    ...(input.config !== undefined && { config: input.config }),
    ...(input.active !== undefined && { active: input.active }),
  } as unknown as never;

  const { data, error } = await supabase
    .from("external_apps")
    .update(payload)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return data as unknown as ExternalAppRow;
}

export async function deleteExternalApp(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("external_apps")
    .delete()
    .eq("id", id);
  if (error) throw error;
}
