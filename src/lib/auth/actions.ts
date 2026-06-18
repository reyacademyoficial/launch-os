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
  // Capturar session_end antes de cerrar sesión (después, auth.uid() es null
  // y la RLS rechaza el insert). Best-effort: si falla, igual cerramos.
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const payload = {
        user_id: user.id,
        kind: "session_end",
      } as never;
      await supabase.from("auth_events").insert(payload);
    }
  } catch {
    // ignore
  }
  await supabase.auth.signOut();
  redirect("/login");
}
