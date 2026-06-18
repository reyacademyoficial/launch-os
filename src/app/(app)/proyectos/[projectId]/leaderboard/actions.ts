"use server";

import { revalidatePath } from "next/cache";

import { requireCanEditLaunchesIn } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export type PayoutActionState =
  | { ok: true; payoutId?: string }
  | { error: string }
  | null;

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

/**
 * Registra un pago al equipo. Guarda cross-tenant: verifica que el team_member
 * y el launch pertenezcan al projectId del path (URL tampering). RLS también
 * bloquea, pero el guard explícito da mejor mensaje al usuario.
 */
export async function createPayout(
  projectId: string,
  _prev: PayoutActionState,
  formData: FormData,
): Promise<PayoutActionState> {
  await requireCanEditLaunchesIn(projectId);

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
  const paid_at = paid_at_raw === "" ? new Date().toISOString().slice(0, 10) : paid_at_raw;

  const notesRaw = str(formData, "notes");
  const notes = notesRaw === "" ? null : notesRaw;

  const supabase = await createClient();

  // Guards cross-tenant.
  const { data: memberData } = await supabase
    .from("team_members")
    .select("project_id")
    .eq("id", team_member_id)
    .maybeSingle();
  const member = memberData as { project_id: string } | null;
  if (!member || member.project_id !== projectId) {
    return { error: "Miembro inexistente o de otro proyecto." };
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
  if (error) return { error: error.message };

  revalidatePath(`/proyectos/${projectId}/leaderboard`);
  return { ok: true, payoutId: (data as { id: string } | null)?.id };
}

export async function deletePayout(
  projectId: string,
  payoutId: string,
): Promise<void> {
  await requireCanEditLaunchesIn(projectId);
  const supabase = await createClient();
  await supabase
    .from("team_member_payouts")
    .delete()
    .eq("id", payoutId)
    .eq("project_id", projectId);
  revalidatePath(`/proyectos/${projectId}/leaderboard`);
}
