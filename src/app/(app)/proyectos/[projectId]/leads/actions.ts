"use server";

import { revalidatePath } from "next/cache";

import { requireCanEditLaunchesIn } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { LEAD_STATUSES, type LeadStatus } from "@/lib/leads/types";

export type LeadActionState = { ok: true } | { error: string } | null;

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function nullable(value: string): string | null {
  return value === "" ? null : value;
}

interface LeadPayload {
  name: string;
  contact: string | null;
  status: LeadStatus;
  notes: string | null;
  launch_id: string | null;
  team_member_id: string | null;
}

function parse(formData: FormData): { ok: true; payload: LeadPayload } | { ok: false; error: string } {
  const name = str(formData, "name");
  if (!name) return { ok: false, error: "El nombre es obligatorio." };

  const statusRaw = str(formData, "status") || "nuevo";
  if (!(LEAD_STATUSES as readonly string[]).includes(statusRaw)) {
    return { ok: false, error: "Status inválido." };
  }

  return {
    ok: true,
    payload: {
      name,
      contact: nullable(str(formData, "contact")),
      status: statusRaw as LeadStatus,
      notes: nullable(str(formData, "notes")),
      launch_id: nullable(str(formData, "launch_id")),
      team_member_id: nullable(str(formData, "team_member_id")),
    },
  };
}

export async function createLead(
  projectId: string,
  _prev: LeadActionState,
  formData: FormData,
): Promise<LeadActionState> {
  await requireCanEditLaunchesIn(projectId);

  const parsed = parse(formData);
  if (!parsed.ok) return { error: parsed.error };

  const supabase = await createClient();
  // source se omite — la DB pone 'manual' por default. Cuando se cablee el
  // camino automático, los providers van a hacer insert por service-role
  // seteando source = provider directo (sin pasar por esta action).
  const insertPayload = { ...parsed.payload, project_id: projectId } as never;
  const { error } = await supabase.from("leads").insert(insertPayload);
  if (error) return { error: error.message };

  revalidatePath(`/proyectos/${projectId}/leads`);
  return { ok: true };
}

export async function updateLead(
  projectId: string,
  leadId: string,
  _prev: LeadActionState,
  formData: FormData,
): Promise<LeadActionState> {
  await requireCanEditLaunchesIn(projectId);

  const parsed = parse(formData);
  if (!parsed.ok) return { error: parsed.error };

  const supabase = await createClient();
  const updatePayload = parsed.payload as never;
  const { error } = await supabase
    .from("leads")
    .update(updatePayload)
    .eq("id", leadId)
    .eq("project_id", projectId);
  if (error) return { error: error.message };

  revalidatePath(`/proyectos/${projectId}/leads`);
  return { ok: true };
}

export async function deleteLead(
  projectId: string,
  leadId: string,
): Promise<void> {
  await requireCanEditLaunchesIn(projectId);

  const supabase = await createClient();
  await supabase.from("leads").delete().eq("id", leadId).eq("project_id", projectId);

  revalidatePath(`/proyectos/${projectId}/leads`);
}

/**
 * Mueve un lead de columna en el kanban — UPDATE puntual solo del status.
 * Se llama desde un client component cuando el usuario suelta una card en otra
 * columna. RLS valida en la DB; el helper revalida la ruta.
 */
export async function moveLeadStatus(
  projectId: string,
  leadId: string,
  status: LeadStatus,
): Promise<{ ok: true } | { error: string }> {
  await requireCanEditLaunchesIn(projectId);

  if (!(LEAD_STATUSES as readonly string[]).includes(status)) {
    return { error: "Status inválido." };
  }

  const supabase = await createClient();
  const payload = { status } as never;
  const { error } = await supabase
    .from("leads")
    .update(payload)
    .eq("id", leadId)
    .eq("project_id", projectId);
  if (error) return { error: error.message };

  revalidatePath(`/proyectos/${projectId}/leads`);
  return { ok: true };
}
