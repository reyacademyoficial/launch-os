import { NextResponse, type NextRequest } from "next/server";

/**
 * Next 16 renamed the `middleware` convention to `proxy`. This file replaces
 * what would have been `src/middleware.ts` in Next 15.
 *
 * Phase 1 stub — pass-through.
 *
 * Phase 3 implements:
 *   1. Supabase session refresh via @supabase/ssr `updateSession` pattern
 *   2. Coarse route protection: unauthenticated users → /login
 *
 * SECURITY: the proxy is auth defense layer #1. It is necessary but NOT
 * sufficient. Every protected layout/page must re-verify the user server-side,
 * and RLS is the final guard. See memory `feedback_nextjs_auth_defense`.
 */
export function proxy(_request: NextRequest) {
  return NextResponse.next();
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
