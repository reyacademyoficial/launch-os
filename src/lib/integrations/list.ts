import "server-only";

import { createClient } from "@/lib/supabase/server";

import type { ProjectIntegrationRow } from "./types";

/**
 * Returns a map from provider id → ProjectIntegrationRow for the project.
 * Providers without any row are absent from the map (handled by the UI as
 * "not configured / disconnected").
 *
 * RLS (`project_integrations_select`) restricts visibility to project members.
 * Notably, secrets are NOT included here — the `project_secrets` table is
 * blinded by RLS-with-no-policies and only the service-role touches it.
 */
export async function listIntegrationsForProject(
  projectId: string,
): Promise<Record<string, ProjectIntegrationRow>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("project_integrations")
    .select("*")
    .eq("project_id", projectId);

  const map: Record<string, ProjectIntegrationRow> = {};
  for (const row of (data ?? []) as ProjectIntegrationRow[]) {
    map[row.provider] = row;
  }
  return map;
}
