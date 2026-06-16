"use server";

import { requireSessionProfile } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Marca una notificación como leída. La RLS de `notifications_update` ya
 * limita el scope a las que el usuario "ve" según el predicado del SELECT
 * (mismo predicado), así que pasar un id ajeno no hace nada — el UPDATE
 * filtra a 0 filas en lugar de fallar. Idempotente: marcar la misma id
 * dos veces no rompe.
 */
export async function markNotificationRead(id: string): Promise<void> {
  await requireSessionProfile();
  const supabase = await createClient();
  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() } as never)
    .eq("id", id)
    .is("read_at", null);
}

/**
 * Marca todas las notificaciones del scope del caller como leídas. Útil
 * para el botón "marcar todas" del panel. Una sola UPDATE — el grant
 * column-level + la RLS hacen el filtro.
 */
export async function markAllNotificationsRead(): Promise<void> {
  await requireSessionProfile();
  const supabase = await createClient();
  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() } as never)
    .is("read_at", null);
}
