"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export type LoginState = { error: string } | null;

export async function signIn(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Email y contraseña son obligatorios." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
    // Don't leak whether the email exists vs the password was wrong.
    return { error: "Credenciales inválidas." };
  }

  // Soft-delete check. Banning at the auth level (deactivateUser action) usually
  // catches this earlier — signInWithPassword would error. This is the
  // belt-and-suspenders fallback in case the ban didn't land.
  const { data: profileCheck } = await supabase
    .from("profiles")
    .select("deleted_at")
    .eq("id", data.user.id)
    .maybeSingle();

  const profileWithFlag = profileCheck as { deleted_at: string | null } | null;
  if (profileWithFlag?.deleted_at) {
    await supabase.auth.signOut();
    return { error: "Tu cuenta fue desactivada. Hablá con un admin." };
  }

  redirect("/");
}
