import "server-only";

import type { ProjectionListItem, ProjectionMode } from "@/lib/projections/types";
import { createClient } from "@/lib/supabase/server";

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
 * Lista las proyecciones del cliente. Filtra por `created_by = auth.uid()`
 * porque el cliente solo ve/edita las suyas, aun cuando la policy
 * `projections_select` deje leer todo el proyecto. El filtro acá es
 * intencional para que la UI no muestre proyecciones del equipo.
 *
 * RLS de escritura (insert/update/delete) ya garantiza que el cliente NO
 * pueda modificar las que no son suyas; este filtro es solo de presentación.
 */
export async function listClientProjections(
  userId: string,
): Promise<ProjectionListItem[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("projections")
    .select("id, name, mode, project_id, created_at, inputs, projects(name)")
    .eq("created_by", userId)
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
