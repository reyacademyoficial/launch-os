"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export type SetPasswordState = { error: string } | null;

const MIN_LEN = 8;

export async function setPassword(
  _prev: SetPasswordState,
  formData: FormData,
): Promise<SetPasswordState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < MIN_LEN) {
    return { error: `La contraseña debe tener al menos ${MIN_LEN} caracteres.` };
  }
  if (password !== confirm) {
    return { error: "Las contraseñas no coinciden." };
  }

  const supabase = await createClient();

  // The user must already be authenticated (set by /auth/confirm).
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Sesión inválida. Volvé a abrir el link del mail." };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { error: error.message };
  }

  redirect("/");
}
