import "server-only";

import { createClient } from "@/lib/supabase/server";

import type { NotificationRow } from "./types";

const DEFAULT_LIST_LIMIT = 20;

/**
 * Últimas N notificaciones del scope del caller. RLS filtra todo:
 *   - Solo proyectos a los que el caller tiene acceso (has_project_access).
 *   - Solo target que matchea (target_user_id = uid, o target_role + rol).
 *
 * No paginamos por ahora: el panel muestra 20 y listo. Si crece, sumamos
 * URL state.
 */
export async function listMyNotifications(
  limit: number = DEFAULT_LIST_LIMIT,
): Promise<NotificationRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("notifications")
    .select(
      "id, project_id, launch_id, type, severity, title, body, read_at, metadata, created_at",
    )
    .order("read_at", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data ?? []) as unknown as NotificationRow[];
}

/**
 * Contador de no leídas del caller. RLS limita el scope; el filtro
 * `read_at is null` corre sobre lo ya filtrado.
 *
 * Usa `count: 'exact'` con `head: true` para no traer rows — es solo el
 * número. Polling cada 30s desde la campanita, así que pesa.
 */
export async function countUnreadNotifications(): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);

  return count ?? 0;
}
