import { NextResponse } from "next/server";

import { listMyNotifications } from "@/lib/notifications/list";
import { getSessionUser } from "@/lib/supabase/auth";

/**
 * GET /api/notifications
 *
 * Lista las últimas 20 del scope del caller (no leídas primero). El panel
 * de la campanita lo consume al abrir. No paginamos; si el scroll del panel
 * pide más en el futuro, se suma `?cursor=`.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ rows: [] });

  const rows = await listMyNotifications();
  return NextResponse.json(
    { rows },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}
