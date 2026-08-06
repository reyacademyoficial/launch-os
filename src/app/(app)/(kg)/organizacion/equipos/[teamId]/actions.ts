"use server";

import { revalidatePath } from "next/cache";

import { resolveCurrentOrganizationId } from "@/lib/organization/current";
import { requireRole } from "@/lib/supabase/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

// ═══════════════════════════════════════════════════════════════════════════
// Actions de membership de un team.
//
// Add: crea row activa. Si ya existe fila inactiva para el mismo par
// (team, person), la reactiva (update in place con nuevo joined_at); si
// existe una activa, rebota 23505 → mensaje amable.
//
// Remove: setea active=false + left_at=today. Preserva historial. Un
// "add" posterior sobre la misma persona reactiva la fila existente.
// ═══════════════════════════════════════════════════════════════════════════

export type AddMemberResult = { ok: true } | { error: string };

export type RemoveMemberResult = { ok: true } | { error: string };

function nullIfEmpty(value: FormDataEntryValue | null): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length === 0 ? null : trimmed;
}

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// addMember
// ═══════════════════════════════════════════════════════════════════════════

export async function addMember(
  teamId: string,
  formData: FormData,
): Promise<AddMemberResult> {
  await requireRole("superadmin");
  if (!teamId) return { error: "Falta el id del equipo." };

  const personId = nullIfEmpty(formData.get("person_id"));
  if (personId == null) return { error: "Elegí una persona." };

  const roleInTeam = nullIfEmpty(formData.get("role_in_team"));

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

  // Ya existe una fila inactiva para (team, person)? La reactivamos con
  // nuevo joined_at. Si existe activa, dejamos que el insert rebote con
  // 23505 → mensaje "ya es miembro".
  const { data: existing } = await supabase
    .from("team_membership")
    .select("id, active")
    .eq("team_id", teamId)
    .eq("organization_person_id", personId)
    .order("joined_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const existingRow = existing as
    | { id: string; active: boolean }
    | null;

  if (existingRow && !existingRow.active) {
    // Reactivar.
    const payload = {
      active: true,
      joined_at: todayYmd(),
      left_at: null,
      role_in_team: roleInTeam,
    } as never;
    const { error } = await supabase
      .from("team_membership")
      .update(payload)
      .eq("id", existingRow.id);
    if (error) return { error: error.message };
    revalidatePath(`/organizacion/equipos/${teamId}`);
    revalidatePath("/organizacion/equipos");
    return { ok: true };
  }

  // Nueva fila.
  const payload = {
    organization_id: organizationId,
    team_id: teamId,
    organization_person_id: personId,
    role_in_team: roleInTeam,
    joined_at: todayYmd(),
    active: true,
  } as never;

  const { error } = await supabase.from("team_membership").insert(payload);
  if (error) {
    if (error.code === "23505") {
      return { error: "Esta persona ya es miembro activo del equipo." };
    }
    return { error: error.message };
  }

  revalidatePath(`/organizacion/equipos/${teamId}`);
  revalidatePath("/organizacion/equipos");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// removeMember — soft: active=false + left_at=today
// ═══════════════════════════════════════════════════════════════════════════

export async function removeMember(
  membershipId: string,
): Promise<RemoveMemberResult> {
  await requireRole("superadmin");
  if (!membershipId) return { error: "Falta el id de la membresía." };

  const supabase = await createSupabaseClient();

  const { data: existing } = await supabase
    .from("team_membership")
    .select("team_id")
    .eq("id", membershipId)
    .maybeSingle();
  const teamId = (existing as { team_id: string } | null)?.team_id;

  const payload = {
    active: false,
    left_at: todayYmd(),
  } as never;

  const { error } = await supabase
    .from("team_membership")
    .update(payload)
    .eq("id", membershipId);

  if (error) return { error: error.message };

  if (teamId) revalidatePath(`/organizacion/equipos/${teamId}`);
  revalidatePath("/organizacion/equipos");
  return { ok: true };
}
