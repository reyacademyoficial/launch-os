"use server";

import { revalidatePath } from "next/cache";

import { resolveCurrentOrganizationId } from "@/lib/organization/current";
import { requireRole } from "@/lib/supabase/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

// ═══════════════════════════════════════════════════════════════════════════
// CRUD de teams (bloque 5 · 0091).
//
// Config org-level (paralelo a organization_people). Requiere superadmin —
// mismo criterio que /organizacion/personas.
//
// Soft delete via `active=false`. Unique parcial
// teams_org_name_active_uniq permite reciclar el nombre de un team
// archivado. Hard delete con guard: solo si NO tiene membresías (activas
// ni inactivas — perderíamos historial).
// ═══════════════════════════════════════════════════════════════════════════

export type CreateTeamState =
  | { ok: true; teamId: string }
  | { error: string }
  | null;

export type UpdateTeamState = { ok: true } | { error: string } | null;

export type ToggleTeamResult = { ok: true } | { error: string };

export type DeleteTeamResult = { ok: true } | { error: string };

function nullIfEmpty(value: FormDataEntryValue | null): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length === 0 ? null : trimmed;
}

interface TeamPayload {
  readonly name: string;
  readonly description: string | null;
  readonly active: boolean;
}

function parseTeamFormData(
  formData: FormData,
  { defaultActive }: { defaultActive: boolean },
): TeamPayload | string {
  const name = String(formData.get("name") ?? "").trim();
  if (name.length === 0) return "El nombre es obligatorio.";
  if (name.length > 200) {
    return "El nombre es demasiado largo (máximo 200 caracteres).";
  }

  const description = nullIfEmpty(formData.get("description"));

  const activeRaw = formData.get("active");
  const active =
    activeRaw === null ? defaultActive : String(activeRaw) === "on";

  return { name, description, active };
}

// ═══════════════════════════════════════════════════════════════════════════
// createTeam
// ═══════════════════════════════════════════════════════════════════════════

export async function createTeam(
  _prev: CreateTeamState,
  formData: FormData,
): Promise<CreateTeamState> {
  await requireRole("superadmin");

  const parsed = parseTeamFormData(formData, { defaultActive: true });
  if (typeof parsed === "string") return { error: parsed };

  let organizationId: string | null;
  try {
    organizationId = await resolveCurrentOrganizationId();
  } catch (e) {
    return {
      error:
        e instanceof Error ? e.message : "Error resolviendo la organización.",
    };
  }
  if (!organizationId) {
    return { error: "No pudimos resolver tu organización. Revisá tus permisos." };
  }

  const supabase = await createSupabaseClient();
  const payload = {
    organization_id: organizationId,
    name: parsed.name,
    description: parsed.description,
    active: parsed.active,
  } as never;

  const { data, error } = await supabase
    .from("teams")
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return {
        error:
          "Ya existe un equipo activo con ese nombre en la organización.",
      };
    }
    return { error: error.message };
  }

  const created = data as { id: string } | null;
  if (!created) return { error: "El insert no devolvió fila." };

  revalidatePath("/organizacion/equipos");
  return { ok: true, teamId: created.id };
}

// ═══════════════════════════════════════════════════════════════════════════
// updateTeam
// ═══════════════════════════════════════════════════════════════════════════

export async function updateTeam(
  teamId: string,
  _prev: UpdateTeamState,
  formData: FormData,
): Promise<UpdateTeamState> {
  await requireRole("superadmin");

  if (!teamId) return { error: "Falta el id del equipo." };

  const parsed = parseTeamFormData(formData, { defaultActive: true });
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createSupabaseClient();
  const payload = {
    name: parsed.name,
    description: parsed.description,
    active: parsed.active,
  } as never;

  const { error } = await supabase
    .from("teams")
    .update(payload)
    .eq("id", teamId);

  if (error) {
    if (error.code === "23505") {
      return {
        error:
          "Ya existe otro equipo activo con ese nombre en la organización.",
      };
    }
    return { error: error.message };
  }

  revalidatePath("/organizacion/equipos");
  revalidatePath(`/organizacion/equipos/${teamId}`);
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// deactivateTeam / reactivateTeam — soft delete via active flag
// ═══════════════════════════════════════════════════════════════════════════

export async function deactivateTeam(
  teamId: string,
): Promise<ToggleTeamResult> {
  await requireRole("superadmin");
  if (!teamId) return { error: "Falta el id del equipo." };
  const supabase = await createSupabaseClient();
  const payload = { active: false } as never;
  const { error } = await supabase
    .from("teams")
    .update(payload)
    .eq("id", teamId);
  if (error) return { error: error.message };
  revalidatePath("/organizacion/equipos");
  return { ok: true };
}

export async function reactivateTeam(
  teamId: string,
): Promise<ToggleTeamResult> {
  await requireRole("superadmin");
  if (!teamId) return { error: "Falta el id del equipo." };
  const supabase = await createSupabaseClient();
  const payload = { active: true } as never;
  const { error } = await supabase
    .from("teams")
    .update(payload)
    .eq("id", teamId);
  if (error) {
    if (error.code === "23505") {
      return {
        error:
          "No se puede reactivar: hay otro equipo activo con el mismo nombre. Renombralo antes.",
      };
    }
    return { error: error.message };
  }
  revalidatePath("/organizacion/equipos");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// deleteTeam — hard delete con guard
//
// Bloquea si tiene membresías (activas o históricas). Archivar (active=
// false) es la ruta normal para "sacar de vista sin perder historial".
// ═══════════════════════════════════════════════════════════════════════════

export async function deleteTeam(
  teamId: string,
): Promise<DeleteTeamResult> {
  await requireRole("superadmin");
  if (!teamId) return { error: "Falta el id del equipo." };

  const supabase = await createSupabaseClient();

  const { count } = await supabase
    .from("team_membership")
    .select("id", { count: "exact", head: true })
    .eq("team_id", teamId);

  if ((count ?? 0) > 0) {
    return {
      error:
        "No se puede eliminar: el equipo tiene historial de membresías. " +
        "Archivalo (destildar 'Activo' en edición) si querés sacarlo de vista.",
    };
  }

  const { error } = await supabase.from("teams").delete().eq("id", teamId);
  if (error) return { error: error.message };

  revalidatePath("/organizacion/equipos");
  return { ok: true };
}
