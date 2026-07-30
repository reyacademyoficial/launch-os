"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import type { TeamMemberRole } from "@/lib/team/types";

import { translateTeamMemberError } from "./translate-error";

// ═══════════════════════════════════════════════════════════════════════════
// Server actions para team_members desde Kingrow — org-wide con selector
// de proyecto en el drawer. Schema sigue project-scope (0013).
//
// Delete: PERMITIDO condicionalmente (schema con ON DELETE RESTRICT hacia
// sales/payouts). Si tiene ventas o payouts asociados, el translate-error
// empuja al toggle active.
// ═══════════════════════════════════════════════════════════════════════════

export type CreateTeamMemberState =
  | { ok: true; memberId: string }
  | { error: string }
  | null;

export type UpdateTeamMemberState = { ok: true } | { error: string } | null;

export type SetTeamMemberActiveResult = { ok: true } | { error: string };

export type DeleteTeamMemberResult = { ok: true } | { error: string };

const VALID_ROLES: readonly TeamMemberRole[] = [
  "setter",
  "closer",
  "media_buyer",
  "manager",
  "otro",
] as const;

interface TeamMemberPayload {
  readonly projectId: string;
  readonly name: string;
  readonly role: TeamMemberRole;
  readonly commissionRate: number | null;
}

function parseFormData(formData: FormData): TeamMemberPayload | string {
  const projectId = String(formData.get("project_id") ?? "").trim();
  if (projectId.length === 0) return "Elegí un proyecto.";

  const name = String(formData.get("name") ?? "").trim();
  if (name.length === 0) return "El nombre del miembro es obligatorio.";

  const roleRaw = String(formData.get("role") ?? "").trim();
  if (!(VALID_ROLES as readonly string[]).includes(roleRaw)) {
    return "El rol elegido no es válido.";
  }
  const role = roleRaw as TeamMemberRole;

  const rateRaw = String(formData.get("commission_rate") ?? "").trim();
  let commissionRate: number | null = null;
  if (rateRaw.length > 0) {
    const parsed = parseFloat(rateRaw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return "El % de comisión tiene que ser un número positivo o quedar vacío.";
    }
    commissionRate = parsed;
  }

  return { projectId, name, role, commissionRate };
}

function revalidateCommon(projectId: string) {
  revalidatePath("/comercial/equipo");
  // Selector de miembro en el sale-modal (LaunchOS): tab de leads + cobros
  // + ventas. Un miembro recién creado / desactivado tiene que reflejarse.
  revalidatePath(`/proyectos/${projectId}/leads`);
  revalidatePath(`/proyectos/${projectId}/cobros`);
  revalidatePath(`/proyectos/${projectId}/ventas`);
  revalidatePath(`/proyectos/${projectId}/leaderboard`);
  revalidatePath(`/proyectos/${projectId}/launches`, "layout");
}

// ═══════════════════════════════════════════════════════════════════════════
// createTeamMember
// ═══════════════════════════════════════════════════════════════════════════

export async function createTeamMember(
  _prev: CreateTeamMemberState,
  formData: FormData,
): Promise<CreateTeamMemberState> {
  await requireRole("superadmin");

  const parsed = parseFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createClient();
  const payload = {
    project_id: parsed.projectId,
    name: parsed.name,
    role: parsed.role,
    commission_rate: parsed.commissionRate,
    active: true,
  } as never;

  const { data, error } = await supabase
    .from("team_members")
    .insert(payload)
    .select("id")
    .single();

  if (error) return { error: translateTeamMemberError(error) };
  const created = data as { id: string } | null;
  if (!created) return { error: "El insert no devolvió fila." };

  revalidateCommon(parsed.projectId);
  return { ok: true, memberId: created.id };
}

// ═══════════════════════════════════════════════════════════════════════════
// updateTeamMember — el projectId NO se puede cambiar (rompería sales/payouts)
// ═══════════════════════════════════════════════════════════════════════════

export async function updateTeamMember(
  memberId: string,
  _prev: UpdateTeamMemberState,
  formData: FormData,
): Promise<UpdateTeamMemberState> {
  await requireRole("superadmin");

  const parsed = parseFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createClient();
  const payload = {
    name: parsed.name,
    role: parsed.role,
    commission_rate: parsed.commissionRate,
  } as never;

  const { error } = await supabase
    .from("team_members")
    .update(payload)
    .eq("id", memberId);

  if (error) return { error: translateTeamMemberError(error) };

  revalidateCommon(parsed.projectId);
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// setTeamMemberActive
// ═══════════════════════════════════════════════════════════════════════════

export async function setTeamMemberActive(
  memberId: string,
  projectId: string,
  active: boolean,
): Promise<SetTeamMemberActiveResult> {
  await requireRole("superadmin");

  const supabase = await createClient();
  const payload = { active } as never;

  const { error } = await supabase
    .from("team_members")
    .update(payload)
    .eq("id", memberId);

  if (error) return { error: translateTeamMemberError(error) };

  revalidateCommon(projectId);
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// deleteTeamMember — solo si no hay sales ni payouts (RESTRICT en DB)
// ═══════════════════════════════════════════════════════════════════════════

export async function deleteTeamMember(
  memberId: string,
  projectId: string,
): Promise<DeleteTeamMemberResult> {
  await requireRole("superadmin");

  const supabase = await createClient();
  const { error } = await supabase
    .from("team_members")
    .delete()
    .eq("id", memberId);

  if (error) return { error: translateTeamMemberError(error) };

  revalidateCommon(projectId);
  return { ok: true };
}
