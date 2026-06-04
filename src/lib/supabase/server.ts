import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

import type { Database } from "@/lib/types/database";

interface CookieToSet {
  name: string;
  value: string;
  options: CookieOptions;
}

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // setAll called from a Server Component — safe to ignore.
            // The proxy (formerly middleware) refreshes the session.
          }
        },
      },
    },
  );
}
