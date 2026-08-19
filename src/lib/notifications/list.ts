import "server-only";

import { createClient } from "@/lib/supabase/server";

import type { NotificationRow } from "./types";

const DEFAULT_LIST_LIMIT = 20;

/**
 * Filtro "launch cerrado": las notifs ligadas a un launch cuyo `closed_at`
 * no es NULL no deben aparecer en el panel. Postgrest no expresa
 * `launch_id IS NULL OR launches.closed_at IS NULL` en un solo query con
 * join, así que partimos en dos ramas:
 *   - Notifs de launches abiertos (`launches!inner` + `closed_at IS NULL`).
 *   - Notifs org-level sin launch (`launch_id IS NULL`).
 * Cada rama pide `limit`; mergeamos y re-ordenamos client-side.
 */

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

  const [openLaunchRes, orgLevelRes] = await Promise.all([
    supabase
      .from("notifications")
      .select(
        "id, project_id, launch_id, type, severity, title, body, read_at, metadata, created_at, launches!inner(closed_at)",
      )
      .is("launches.closed_at", null)
      .order("read_at", { ascending: true, nullsFirst: true })
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("notifications")
      .select(
        "id, project_id, launch_id, type, severity, title, body, read_at, metadata, created_at",
      )
      .is("launch_id", null)
      .order("read_at", { ascending: true, nullsFirst: true })
      .order("created_at", { ascending: false })
      .limit(limit),
  ]);

  type WithJoin = NotificationRow & {
    launches?: { closed_at: string | null } | null;
  };
  const merged: WithJoin[] = [
    ...((openLaunchRes.data ?? []) as unknown as WithJoin[]),
    ...((orgLevelRes.data ?? []) as unknown as WithJoin[]),
  ];

  // Re-sort merged: no leídas primero (read_at ASC nulls first), luego más
  // reciente primero (created_at DESC).
  merged.sort((a, b) => {
    if (a.read_at === null && b.read_at !== null) return -1;
    if (b.read_at === null && a.read_at !== null) return 1;
    if (a.read_at !== b.read_at) {
      return (a.read_at ?? "").localeCompare(b.read_at ?? "");
    }
    return b.created_at.localeCompare(a.created_at);
  });

  return merged.slice(0, limit).map(({ launches: _launches, ...rest }) => rest);
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

  const [openLaunchRes, orgLevelRes] = await Promise.all([
    supabase
      .from("notifications")
      .select("id, launches!inner(closed_at)", { count: "exact", head: true })
      .is("read_at", null)
      .is("launches.closed_at", null),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .is("read_at", null)
      .is("launch_id", null),
  ]);

  return (openLaunchRes.count ?? 0) + (orgLevelRes.count ?? 0);
}
