"use server";

import { revalidatePath } from "next/cache";

import { requireCanEditLaunchesIn } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import type { TeamMemberRole } from "@/lib/team/types";

export type TeamActionState = { ok: true } | { error: string } | null;

const VALID_ROLES: readonly TeamMemberRole[] = [
  "setter",
  "closer",
  "media_buyer",
  "manager",
  "otro",
] as const;

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

interface TeamMemberPayload {
  name: string;
  role: TeamMemberRole;
  commission_rate: number | null;
  active: boolean;
}

function parse(formData: FormData): { ok: true; payload: TeamMemberPayload } | { ok: false; error: string } {
  const name = str(formData, "name");
  if (!name) return { ok: false, error: "El nombre es obligatorio." };

  const roleRaw = str(formData, "role");
  if (!(VALID_ROLES as readonly string[]).includes(roleRaw)) {
    return { ok: false, error: "Rol inválido." };
  }

  const rateRaw = str(formData, "commission_rate");
  let commission_rate: number | null = null;
  if (rateRaw !== "") {
    const parsed = parseFloat(rateRaw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return { ok: false, error: "% de comisión inválido." };
    }
    commission_rate = parsed;
  }

  // Checkbox "active": presente cuando está tildado, ausente cuando no.
  const active = formData.get("active") !== null;

  return {
    ok: true,
    payload: {
      name,
      role: roleRaw as TeamMemberRole,
      commission_rate,
      active,
    },
  };
}

export async function createTeamMember(
  projectId: string,
  _prev: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  await requireCanEditLaunchesIn(projectId);

  const parsed = parse(formData);
  if (!parsed.ok) return { error: parsed.error };

  const supabase = await createClient();
  const insertPayload = { ...parsed.payload, project_id: projectId } as never;
  const { error } = await supabase.from("team_members").insert(insertPayload);
  if (error) return { error: error.message };

  revalidatePath(`/proyectos/${projectId}/equipo`);
  return { ok: true };
}

export async function updateTeamMember(
  projectId: string,
  memberId: string,
  _prev: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  await requireCanEditLaunchesIn(projectId);

  const parsed = parse(formData);
  if (!parsed.ok) return { error: parsed.error };

  const supabase = await createClient();
  const updatePayload = parsed.payload as never;
  const { error } = await supabase
    .from("team_members")
    .update(updatePayload)
    .eq("id", memberId)
    .eq("project_id", projectId);
  if (error) return { error: error.message };

  revalidatePath(`/proyectos/${projectId}/equipo`);
  return { ok: true };
}

export async function deleteTeamMember(
  projectId: string,
  memberId: string,
): Promise<void> {
  await requireCanEditLaunchesIn(projectId);

  const supabase = await createClient();
  await supabase
    .from("team_members")
    .delete()
    .eq("id", memberId)
    .eq("project_id", projectId);

  revalidatePath(`/proyectos/${projectId}/equipo`);
}
