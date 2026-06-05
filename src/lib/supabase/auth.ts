import "server-only";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export type Role = "superadmin" | "admin" | "cliente";

export interface SessionProfile {
  id: string;
  email: string | null;
  fullName: string | null;
  role: Role;
}

/**
 * Returns the authenticated user or null. Use when the absence of a session
 * is a valid state (e.g., the login page deciding whether to reverse-redirect).
 */
export async function getSessionUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/**
 * Returns the authenticated user + their profile row, or null.
 *
 * The profile row read goes through RLS: each user's own profile is readable
 * by themselves (policy `profiles_select` in 0003_rls.sql), so this always
 * works for the logged-in caller.
 */
interface ProfileSummary {
  id: string;
  full_name: string | null;
  role: string;
}

export async function getSessionProfile(): Promise<SessionProfile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Cast at the boundary: postgrest-js inference collapses to `never` when the
  // generated Database type includes the `__InternalSupabase` version marker.
  // Known issue in supabase-js 2.107 + @supabase/ssr 0.6.1. The runtime shape
  // matches `ProfileSummary` because the SQL select pins these columns.
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .eq("id", user.id)
    .maybeSingle();

  const profile = data as ProfileSummary | null;
  if (error || !profile) return null;

  return {
    id: profile.id,
    email: user.email ?? null,
    fullName: profile.full_name,
    role: profile.role as Role,
  };
}

/**
 * Defense-in-depth layer 2: redirect unauthenticated users to /login.
 * Call from every `(app)` and `(admin)` layout/page that requires a session.
 */
export async function requireSessionProfile(): Promise<SessionProfile> {
  const profile = await getSessionProfile();
  if (!profile) redirect("/login");
  return profile;
}

/**
 * Defense-in-depth layer 2 with a role gate.
 * If the caller's role isn't in the allowed list, redirect to "/".
 */
export async function requireRole(
  ...allowed: readonly [Role, ...Role[]]
): Promise<SessionProfile> {
  const profile = await requireSessionProfile();
  if (!allowed.includes(profile.role)) redirect("/");
  return profile;
}
