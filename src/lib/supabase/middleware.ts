import "server-only";

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/lib/types/database";

interface CookieToSet {
  name: string;
  value: string;
  options: CookieOptions;
}

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

  return { response, user };
}
