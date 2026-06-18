import "server-only";

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/lib/types/database";

interface CookieToSet {
  name: string;
  value: string;
  options: CookieOptions;
}

const SESSION_TRACK_COOKIE = "la_session_seen";
const SESSION_TRACK_MAX_AGE = 60 * 60 * 8; // 8h — dedup intra-sesión.

/**
 * Session refresh helper used by `src/proxy.ts`.
 *
 * Pattern straight out of the @supabase/ssr docs for App Router. The proxy
 * runs this on every matched request to:
 *   - Refresh expired auth tokens against the auth server.
 *   - Mirror updated cookies into both the incoming request (so downstream
 *     consumers in the same request see them) and the outgoing response (so
 *     the browser stores them).
 *
 * Returns `{ user, response }`. `user` is null for unauthenticated requests.
 * The proxy uses `user` for coarse routing; route-level checks still happen
 * server-side in each protected layout/page.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Required — getUser() forces a token refresh + signs the response cookies.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Auditoría de sesión: una fila session_start por sesión lógica. La cookie
  // SESSION_TRACK_COOKIE actúa de dedup para no escribir en cada request. Si
  // el usuario cierra sesión, signOut() limpia las cookies de auth; en el
  // próximo login no habrá cookie y se registrará un nuevo session_start.
  if (user && !request.cookies.has(SESSION_TRACK_COOKIE)) {
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      null;
    const ua = request.headers.get("user-agent");
    try {
      const payload = {
        user_id: user.id,
        kind: "session_start",
        ip,
        user_agent: ua,
      } as never;
      await supabase.from("auth_events").insert(payload);
    } catch {
      // Auditoría es best-effort: nunca rompemos el request si falla.
    }
    response.cookies.set(SESSION_TRACK_COOKIE, "1", {
      httpOnly: true,
      sameSite: "lax",
      maxAge: SESSION_TRACK_MAX_AGE,
      path: "/",
    });
  }

  return { response, user };
}
