import "server-only";

import { createClient } from "@/lib/supabase/server";

import type {
  ProjectionListItem,
  ProjectionMode,
} from "./types";

interface RawRow {
  id: string;
  name: string;
  mode: string;
  project_id: string;
  created_at: string;
  inputs: unknown;
  projects: { name: string } | null;
}

/**
 * Returns all projections the caller can read, newest first. RLS scopes the
 * result to the caller's accessible projects — passing nothing avoids a per-
 * project round trip. Joins `projects.name` for the grouped UI list.
 */
export async function listAccessibleProjections(): Promise<ProjectionListItem[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("projections")
    .select("id, name, mode, project_id, created_at, inputs, projects(name)")
    .order("created_at", { ascending: false });

  const rows = (data ?? []) as unknown as RawRow[];

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    mode: r.mode as ProjectionMode,
    project_id: r.project_id,
    project_name: r.projects?.name ?? "—",
    created_at: r.created_at,
    inputs: r.inputs as ProjectionListItem["inputs"],
  }));
}
