import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * Lista de evergreens que reciclan al launch dado. Útil para mostrar la
 * asociación inversa en el detalle del lanzamiento destino (ver 8a:
 * "varios evergreens → 1 destino").
 *
 * Devuelve `[]` cuando no hay ninguno o cuando RLS lo oculta — para el
 * caller no hay diferencia.
 */
export interface EvergreenSourceRef {
  id: string;
  name: string;
  closed_at: string | null;
}

export async function listEvergreensTargeting(
  launchId: string,
): Promise<EvergreenSourceRef[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("launches")
    .select("id, name, closed_at")
    .eq("is_evergreen", true)
    .eq("recycle_target_launch_id", launchId)
    .order("name", { ascending: true });

  return (data ?? []) as EvergreenSourceRef[];
}
