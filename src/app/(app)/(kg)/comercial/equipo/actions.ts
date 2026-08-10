"use server";

import { revalidatePath } from "next/cache";

import { resolveCurrentOrganizationId } from "@/lib/organization/current";
import { requireRole } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import type { TeamMemberRole } from "@/lib/team/types";

import { translateTeamMemberError } from "./translate-error";

// ═══════════════════════════════════════════════════════════════════════════
// Server actions para team_members — org-scope desde 0124.
//
// El equipo comercial es único a nivel organización: un mismo closer trabaja
// para todos los proyectos de Kingrow. Por eso el form ya no pide project_id
// (antes lo pedía) — el organization_id se resuelve del user en runtime.
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
  readonly name: string;
  readonly role: TeamMemberRole;
  readonly commissionRate: number | null;
}

function parseFormData(formData: FormData): TeamMemberPayload | string {
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

  return { name, role, commissionRate };
}

function revalidateCommon() {
  revalidatePath("/comercial/equipo");
  // El selector de miembro vive en cada proyecto (leads/cobros/ventas). Como
  // team_members es org-wide desde 0124, cualquier alta/edición afecta a
  // TODOS los proyectos — revalidamos el layout raíz de proyectos para que
  // los server components vuelvan a leer.
  revalidatePath("/proyectos", "layout");
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
  const organizationId = await resolveCurrentOrganizationId(supabase);
  if (!organizationId) {
    return { error: "No se pudo resolver tu organización actual." };
  }

  const payload = {
    organization_id: organizationId,
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

  revalidateCommon();
  return { ok: true, memberId: created.id };
}

// ═══════════════════════════════════════════════════════════════════════════
// updateTeamMember
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

  revalidateCommon();
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// setTeamMemberActive
// ═══════════════════════════════════════════════════════════════════════════

export async function setTeamMemberActive(
  memberId: string,
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

  revalidateCommon();
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// deleteTeamMember — solo si no hay sales ni payouts (RESTRICT en DB)
// ═══════════════════════════════════════════════════════════════════════════

export async function deleteTeamMember(
  memberId: string,
): Promise<DeleteTeamMemberResult> {
  await requireRole("superadmin");

  const supabase = await createClient();
  const { error } = await supabase
    .from("team_members")
    .delete()
    .eq("id", memberId);

  if (error) return { error: translateTeamMemberError(error) };

  revalidateCommon();
  return { ok: true };
}
