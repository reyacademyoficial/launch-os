import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/types/database";

/**
 * Service-role Supabase client. Bypasses RLS entirely.
 *
 * Use ONLY from Server Actions / Route Handlers for operations the user is not
 * allowed to do as themselves: inviting users (`auth.admin.inviteUserByEmail`),
 * inserting into `project_members`, reading/writing `project_secrets`.
 *
 * NEVER import this from a client component or expose its results to the browser
 * without filtering by the caller's permissions.
 */
export function createServiceClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
