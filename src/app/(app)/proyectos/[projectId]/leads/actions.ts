"use server";

import { revalidatePath } from "next/cache";

import { requireCanEditLaunchesIn } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;
import { LEAD_STATUSES, type LeadStatus } from "@/lib/leads/types";

export type LeadActionState = { ok: true } | { error: string } | null;

/**
 * Re-sincroniza `sales.team_member_id` con `leads.team_member_id` para una
 * lista de leadIds del proyecto. Es la copia "lazy" que mantiene la
 * denormalización alineada con la verdad (`leads.team_member_id`).
 *
 * El Leaderboard y el PDF de comisiones leen el dueño desde el lead, así que
 * este re-sync no afecta esos números. Lo mantenemos por (a) los queries
 * ad-hoc en Studio que aún miran `sales.team_member_id`, y (b) para que el
 * backfill 0036 no se vuelva necesario más adelante.
 *
 * Idempotente: el UPDATE no hace nada si los valores ya están alineados.
 */
async function syncSalesOwnerForLeads(
  supabase: SupabaseServerClient,
  projectId: string,
  leadIds: ReadonlyArray<string>,
): Promise<void> {
  if (leadIds.length === 0) return;

  const { data: leadsRows } = await supabase
    .from("leads")
    .select("id, team_member_id")
    .eq("project_id", projectId)
    .in("id", leadIds);
  const owners =
    (leadsRows as Array<{ id: string; team_member_id: string | null }> | null) ??
    [];

  // Postgrest no expone UPDATE … FROM, así que mandamos 1 UPDATE por lead.
  // El batch típico de un changeo manual es ≤ algunas decenas y de un bulk
  // assign cap 1000; sigue siendo aceptable, y es lectura→escritura puntual.
  for (const l of owners) {
    await supabase
      .from("sales")
      .update({ team_member_id: l.team_member_id } as never)
      .eq("project_id", projectId)
      .eq("lead_id", l.id);
  }
}

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

  // Tras tocar el lead, re-alinear sales del lead. Si el setter no cambió
  // es no-op. Si cambió, las sales reflejan el nuevo dueño.
  await syncSalesOwnerForLeads(supabase, projectId, [leadId]);

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
 * Reasigna el vendedor de un lead — UPDATE puntual solo del team_member_id.
 * Sincroniza la denorm en `sales` para que la tabla de Ventas y el filtro
 * por vendor reflejen el cambio (post-0047 el leaderboard atribuye por
 * lead directo, pero mantener la denorm alineada evita drifts futuros).
 *
 * Diseñado para el dropdown inline del SalePanel — el operador no quiere
 * abrir el LeadForm completo solo para reasignar el closer de una venta.
 * Cambiar el vendor del lead propaga a TODAS las ventas del lead (por
 * diseño: un lead tiene un dueño único; sus ventas heredan).
 */
export async function assignLeadOwner(
  projectId: string,
  leadId: string,
  teamMemberId: string | null,
): Promise<{ ok: true } | { error: string }> {
  await requireCanEditLaunchesIn(projectId);

  const supabase = await createClient();
  const payload = { team_member_id: teamMemberId } as never;
  const { error } = await supabase
    .from("leads")
    .update(payload)
    .eq("id", leadId)
    .eq("project_id", projectId);
  if (error) return { error: error.message };

  await syncSalesOwnerForLeads(supabase, projectId, [leadId]);

  revalidatePath(`/proyectos/${projectId}/leads`);
  revalidatePath(`/proyectos/${projectId}/ventas`);
  revalidatePath(`/proyectos/${projectId}/cobros`);
  revalidatePath(`/proyectos/${projectId}/leaderboard`);
  return { ok: true };
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
