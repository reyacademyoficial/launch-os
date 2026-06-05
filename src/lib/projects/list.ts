import "server-only";

import { createClient } from "@/lib/supabase/server";

export interface ProjectListItem {
  id: string;
  name: string;
}

/**
 * Returns the projects the caller can read, ordered alphabetically.
 *
 * Filtering is delegated to RLS (`projects_select` policy in 0003): superadmin
 * sees all, admin and cliente see only their `project_members` rows. Used by
 * the (app) and (admin) layouts to populate the topbar switcher, and by the
 * picker at `/`.
 */
export async function listAccessibleProjects(): Promise<ProjectListItem[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select("id, name")
    .order("name", { ascending: true });

  return (data ?? []) as ProjectListItem[];
}
