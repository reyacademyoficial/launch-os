"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

import { translatePayoutError } from "./translate-error";

// ═══════════════════════════════════════════════════════════════════════════
// Server actions para team_member_payouts desde Kingrow.
//
// Adaptación de leaderboard/actions.ts de LaunchOS. Diferencias:
//   1. requireRole("superadmin") en vez de requireCanEditLaunchesIn.
//   2. revalidatePath apunta a /comercial/ranking.
//
// Guard cross-tenant post 0124: team_members es org-scope, así que ya no se
// puede chequear "member pertenece a este proyecto". El check pasa a "member
// pertenece a la MISMA org que el proyecto del payout". Launch sigue
// project-scope (chequeo directo). RLS ya bloquea; el mensaje friendly ayuda.
// ═══════════════════════════════════════════════════════════════════════════

export type PayoutActionState =
  | { ok: true; payoutId?: string }
  | { error: string }
  | null;

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function createPayout(
  projectId: string,
  _prev: PayoutActionState,
  formData: FormData,
): Promise<PayoutActionState> {
  await requireRole("superadmin");

  const team_member_id = str(formData, "team_member_id");
  if (!team_member_id) return { error: "Falta el miembro del equipo." };

  const launch_id = str(formData, "launch_id");
  if (!launch_id) return { error: "Elegí un lanzamiento." };

  const amountRaw = str(formData, "amount");
  const amount = parseFloat(amountRaw);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "Monto inválido (tiene que ser > 0)." };
  }

  const paid_at_raw = str(formData, "paid_at");
  const paid_at =
    paid_at_raw === "" ? new Date().toISOString().slice(0, 10) : paid_at_raw;

  const notesRaw = str(formData, "notes");
  const notes = notesRaw === "" ? null : notesRaw;

  const supabase = await createClient();

  // Guards cross-tenant: launch pertenece al proyecto (project-scope) y el
  // miembro pertenece a la MISMA org que el proyecto (member es org-scope
  // post 0124). Sin esto un payload manipulado desde el cliente podría
  // registrar un payout con datos cruzados de proyectos u orgs.
  const { data: projectData } = await supabase
    .from("projects")
    .select("organization_id")
    .eq("id", projectId)
    .maybeSingle();
  const project = projectData as { organization_id: string } | null;
  if (!project) {
    return { error: "Proyecto inexistente o inaccesible." };
  }

  const { data: memberData } = await supabase
    .from("team_members")
    .select("organization_id")
    .eq("id", team_member_id)
    .maybeSingle();
  const member = memberData as { organization_id: string } | null;
  if (!member || member.organization_id !== project.organization_id) {
    return { error: "Miembro inexistente o de otra organización." };
  }

  const { data: launchData } = await supabase
    .from("launches")
    .select("project_id")
    .eq("id", launch_id)
    .maybeSingle();
  const launch = launchData as { project_id: string } | null;
  if (!launch || launch.project_id !== projectId) {
    return { error: "Lanzamiento inexistente o de otro proyecto." };
  }

  const payload = {
    project_id: projectId,
    team_member_id,
    launch_id,
    amount,
    paid_at,
    notes,
  } as never;

  const { data, error } = await supabase
    .from("team_member_payouts")
    .insert(payload)
    .select("id")
    .single();
  if (error) return { error: translatePayoutError(error) };

  revalidatePath("/comercial/ranking");
  return { ok: true, payoutId: (data as { id: string } | null)?.id };
}

export async function deletePayout(
  projectId: string,
  payoutId: string,
): Promise<void> {
  await requireRole("superadmin");
  const supabase = await createClient();
  await supabase
    .from("team_member_payouts")
    .delete()
    .eq("id", payoutId)
    .eq("project_id", projectId);
  revalidatePath("/comercial/ranking");
}
