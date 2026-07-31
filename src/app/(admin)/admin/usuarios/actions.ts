"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/service";

export type CreateUserState =
  | { ok: true; userId: string; email: string; role: CreatableRole }
  | { error: string }
  | null;

// superadmin is intentionally NOT creatable from the UI — promotion to
// superadmin still requires Studio + disabling guard_profile_role briefly
// (see 0004_seed.sql for the bootstrap procedure).
const CREATABLE_ROLES = ["admin", "operador", "analista", "cliente"] as const;
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

// ─── update + deactivate ──────────────────────────────────────────────────────

export type UpdateUserState = { ok: true } | { error: string } | null;

/**
 * Updates a user's profile + project assignment + role.
 *
 * `role` es editable desde la UI: el service_role bypass en `guard_profile_role`
 * (migración 0034) permite el cambio sin desactivar el trigger. `superadmin` no
 * es un rol asignable desde la UI (mismo criterio que en `createUser`) para
 * evitar promociones accidentales; si el usuario YA es superadmin, tampoco se
 * lo puede degradar desde acá — hay que hacerlo por Studio.
 *
 * Para superadmin el selector de proyectos se ignora — superadmins no cargan
 * project_members por diseño.
 */
export async function updateUser(
  userId: string,
  _prev: UpdateUserState,
  formData: FormData,
): Promise<UpdateUserState> {
  await requireRole("superadmin");

  const fullName = String(formData.get("full_name") ?? "").trim();
  const submittedRole = String(formData.get("role") ?? "");
  // Multi-select form posts repeated `project_ids` entries. We accept zero or
  // more — admins/clientes can be assigned to several projects.
  const projectIds = formData
    .getAll("project_ids")
    .map(String)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const uniqueProjectIds = Array.from(new Set(projectIds));

  const service = createServiceClient();

  // Lookup current role to decide whether to manage project_members.
  const { data: profileRow } = await service
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  const currentRole = (profileRow as { role: string } | null)?.role;
  if (!currentRole) return { error: "No se encontró el perfil del usuario." };

  // Resolver el rol efectivo tras el submit.
  // - Si el usuario ya es superadmin, el form no envía `role` (campo oculto) y
  //   se mantiene tal cual. No permitimos demote desde la UI.
  // - Si envía un rol, tiene que ser uno de los creatables. Cualquier intento
  //   de escalar a superadmin/dev vía formData se rechaza acá.
  let effectiveRole = currentRole;
  if (currentRole !== "superadmin") {
    if (!submittedRole) return { error: "Tenés que elegir un rol." };
    if (!isCreatableRole(submittedRole)) return { error: "Rol inválido." };
    effectiveRole = submittedRole;
  }

  const roleChanged = effectiveRole !== currentRole;

  const profilePayload = {
    full_name: fullName.length > 0 ? fullName : null,
    ...(roleChanged ? { role: effectiveRole } : {}),
  } as never;

  const { error: profileError } = await service
    .from("profiles")
    .update(profilePayload)
    .eq("id", userId);

  if (profileError) return { error: profileError.message };

  // Manage project assignments for every non-superadmin role. Superadmin
  // doesn't belong to project_members per spec; everyone else does (admin,
  // operador, analista, cliente — pertenencia define el proyecto).
  if (effectiveRole !== "superadmin") {
    if (uniqueProjectIds.length === 0) {
      return { error: "Asigná al menos un proyecto." };
    }

    // Sync to exactly the selected set: wipe existing memberships, then
    // insert the new set. Two-step instead of diffing because the table is
    // small (rows per user are bounded) and idempotency matters more than
    // micro-optimization here.
    await service.from("project_members").delete().eq("user_id", userId);

    const memberPayload = uniqueProjectIds.map((projectId) => ({
      user_id: userId,
      project_id: projectId,
    })) as never;

    const { error: memberError } = await service
      .from("project_members")
      .insert(memberPayload);

    if (memberError) {
      return {
        error: `Datos guardados, pero falló la asignación a proyectos: ${memberError.message}`,
      };
    }
  }

  revalidatePath("/admin/usuarios");
  return { ok: true };
}

/**
 * Soft-delete a user: set `profiles.deleted_at` (preserves the row + all related
 * data) AND ban via `auth.admin.updateUserById` so existing sessions get
 * invalidated and they can't sign in again.
 *
 * Reversible desde la UI vía `reactivateUser`.
 */
export async function deactivateUser(userId: string): Promise<void> {
  await requireRole("superadmin");

  const service = createServiceClient();

  const payload = { deleted_at: new Date().toISOString() } as never;
  await service.from("profiles").update(payload).eq("id", userId);

  // Supabase `ban_duration` accepts duration strings ("24h", "30d", etc.) or
  // "none" to unban. There's no "forever" sentinel; a very long string serves.
  await service.auth.admin.updateUserById(userId, {
    ban_duration: "876000h", // ~100 years
  });

  revalidatePath("/admin/usuarios");
}

/**
 * Undo de `deactivateUser`: limpia `profiles.deleted_at` y desbanea al usuario
 * en auth.users con `ban_duration: 'none'`. Deja al usuario en el mismo estado
 * previo (mismos memberships, mismo rol).
 */
export async function reactivateUser(userId: string): Promise<void> {
  await requireRole("superadmin");

  const service = createServiceClient();

  const payload = { deleted_at: null } as never;
  await service.from("profiles").update(payload).eq("id", userId);

  await service.auth.admin.updateUserById(userId, {
    ban_duration: "none",
  });

  revalidatePath("/admin/usuarios");
}
