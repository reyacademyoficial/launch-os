import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * external_apps — apps externas asociadas a un proyecto propio (migración
 * 0153 + 0156). El botón del curso simplemente abre `base_url` en nueva
 * pestaña; no hay SSO, JWT, ni secret.
 *
 * Cast `as unknown as never` en payloads para esquivar el "never inference"
 * de postgrest-js.
 */

export interface ExternalAppRow {
  id: string;
  project_id: string;
  name: string;
  base_url: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateExternalAppInput {
  project_id: string;
  name: string;
  base_url: string;
  active?: boolean;
}

export interface UpdateExternalAppInput {
  name?: string;
  base_url?: string;
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
