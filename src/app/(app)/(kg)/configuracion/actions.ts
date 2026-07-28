"use server";

import { revalidatePath } from "next/cache";

import { requireSessionProfile } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export type ConfigState = { ok: true } | { error: string } | null;

const MIN_PASSWORD = 8;

/**
 * Updates the caller's own `full_name`. RLS lets every user update their own
 * profile row (policy `profiles_update` in 0003), and the `guard_profile_role`
 * trigger blocks `role` changes — so we explicitly pass only `full_name` here.
 */
export async function updateProfile(
  _prev: ConfigState,
  formData: FormData,
): Promise<ConfigState> {
  const profile = await requireSessionProfile();
  const fullName = String(formData.get("full_name") ?? "").trim();

  // Same `never`-inference workaround as in lib/supabase/auth.ts. The runtime
  // payload matches the profiles Update shape; cast at the call site.
  const supabase = await createClient();
  const payload = {
    full_name: fullName.length > 0 ? fullName : null,
  } as never;

  const { error } = await supabase
    .from("profiles")
    .update(payload)
    .eq("id", profile.id);

  if (error) return { error: error.message };

  revalidatePath("/configuracion");
  return { ok: true };
}

/**
 * Updates the caller's own password via `supabase.auth.updateUser`. The
 * session must be active (guaranteed by the (app) layout's requireSessionProfile).
 */
export async function updatePassword(
  _prev: ConfigState,
  formData: FormData,
): Promise<ConfigState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < MIN_PASSWORD) {
    return { error: `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.` };
  }
  if (password !== confirm) {
    return { error: "Las contraseñas no coinciden." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });

  if (error) return { error: error.message };
  return { ok: true };
}
