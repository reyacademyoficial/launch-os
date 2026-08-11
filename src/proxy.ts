import { NextResponse, type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

/**
 * Next 16 renamed the `middleware` convention to `proxy`. Same file model.
 *
 * Two responsibilities:
 *   1. Refresh the Supabase auth session on every request (cookies in/out).
 *   2. Coarse-grained route protection — bounce unauthenticated requests off
 *      protected paths to /login.
 *
 * SECURITY: this is auth defense layer #1. NOT sufficient on its own. Every
 * protected layout/page re-verifies server-side via `requireSessionProfile`
 * (or `requireRole`); RLS is the final guard. See memory
 * `feedback_nextjs_auth_defense`.
 */

// Paths that don't need a session. Everything else does.
// `/api/cron` está acá porque Vercel Cron llega sin cookie de Supabase; el
// handler valida por su cuenta el header `Authorization: Bearer CRON_SECRET`.
const PUBLIC_PATHS: readonly string[] = [
  "/login",
  "/auth/confirm",
  "/api/cron",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function proxy(request: NextRequest) {
  const { response, user } = await updateSession(request);

  if (!user && !isPublic(request.nextUrl.pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     *   - _next/static, _next/image (Next assets)
     *   - favicon.ico
     *   - static asset extensions
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
