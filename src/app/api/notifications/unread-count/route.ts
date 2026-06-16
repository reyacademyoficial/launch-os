import { NextResponse } from "next/server";

import { countUnreadNotifications } from "@/lib/notifications/list";
import { getSessionUser } from "@/lib/supabase/auth";

/**
 * GET /api/notifications/unread-count
 *
 * Polling pasivo desde la campanita cada 30s. Devuelve un número y nada
 * más. Si no hay sesión, devolvemos 0 sin error — la campanita se monta
 * en cualquier shell autenticado, pero un usuario que cerró sesión vería
 * un 401 ruidoso si fuésemos estrictos.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ count: 0 });

  const count = await countUnreadNotifications();
  return NextResponse.json(
    { count },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}
