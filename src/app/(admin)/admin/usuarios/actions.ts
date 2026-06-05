"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/service";

export type CreateUserState =
  | { ok: true; userId: string; email: string; role: CreatableRole }
  | { error: string }
  | null;

const CREATABLE_ROLES = ["admin", "cliente"] as const;
type CreatableRole = (typeof CREATABLE_ROLES)[number];

function isCreatableRole(value: string): value is CreatableRole {
  return (CREATABLE_ROLES as readonly string[]).includes(value);
}

const MIN_PASSWORD = 8;

/**
 * Creates a new user with the provided email + password and assigns them to a
 * project, in one shot. NO invitation email — the superadmin shares the
 * credentials with the user out-of-band (WhatsApp, password manager, etc.).
 *
 * Auth boundary:
 *   - `requireRole('superadmin')` is the real gate. Server Actions can be
 *     called by URL, not just from a rendered page, so the layout isn't enough.
 *   - The service-role client bypasses RLS for the two operations that the
 *     caller themselves wouldn't be allowed to do: `auth.admin.createUser`
 *     (service-role-only) and the `project_members` insert (currently
 *     superadmin-only write per RLS).
 *
 * `email_confirm: true` skips the Supabase confirmation email and marks the
 * user as immediately usable (`email_confirmed_at` is set), so they can log in
 * the instant the superadmin shares the credentials.
 */
export async function createUser(
  _prev: CreateUserState,
  formData: FormData,
): Promise<CreateUserState> {
  await requireRole("superadmin");

  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("full_name") ?? "").trim();
  const role = String(formData.get("role") ?? "");
  const projectId = String(formData.get("project_id") ?? "");

  if (!email) return { error: "El email es obligatorio." };
  if (password.length < MIN_PASSWORD) {
    return { error: `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.` };
  }
  if (!isCreatableRole(role)) return { error: "Rol inválido." };
  if (!projectId) return { error: "Tenés que elegir un proyecto." };

  const service = createServiceClient();

  const { data: created, error: createError } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, role },
  });

  if (createError || !created?.user) {
    return { error: createError?.message ?? "No se pudo crear el usuario." };
  }

  // The handle_new_user trigger fired on the auth.users insert and created the
  // profile with the right role (read from user_metadata). All that's left is
  // the project assignment.
  const { error: memberError } = await service
    .from("project_members")
    .insert({ project_id: projectId, user_id: created.user.id });

  if (memberError) {
    return {
      error:
        `Usuario creado, pero falló la asignación al proyecto: ${memberError.message}. ` +
        `Asignalo manualmente (user_id ${created.user.id}).`,
    };
  }

  revalidatePath("/admin/usuarios");
  return { ok: true, userId: created.user.id, email, role };
}
