"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

/**
 * Sign the current user out and bounce to /login.
 *
 * Triggered from the Topbar's logout form. `supabase.auth.signOut()` clears the
 * session cookies via the @supabase/ssr server client's cookie handlers, so
 * the response that follows the action already has the cleared Set-Cookie
 * headers attached.
 */
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
