"use server";

import { revalidatePath } from "next/cache";

import { requireCanEditLaunchesIn } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export type SaleActionState = { ok: true; saleId?: string } | { error: string } | null;

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function nullable(value: string): string | null {
  return value === "" ? null : value;
}

/**
 * Crea una sale para un lead. El lead pasa automáticamente a status='cerrado'
 * (la venta es la confirmación del cierre). El brief dice "una venta cuelga
 * de un lead cerrado": elegimos cerrarlo nosotros al crear la venta, en lugar
 * de exigir que el usuario lo mueva antes — UX más directa.
 *
 * ATRIBUCIÓN: la sale hereda `team_member_id` del lead. Es denormalización,
 * NO input del operador. El formulario perdió el dropdown de closer (era
 * editable y generaba drift). Si el dueño del lead cambia, `updateLead`
 * re-sincroniza las sales del lead.
 */
export async function createSale(
  projectId: string,
  leadId: string,
  _prev: SaleActionState,
  formData: FormData,
): Promise<SaleActionState> {
  await requireCanEditLaunchesIn(projectId);

  const payment_modality_id = str(formData, "payment_modality_id");
  if (!payment_modality_id) return { error: "Elegí una modalidad." };

  const totalRaw = str(formData, "total_amount");
  const total_amount = parseFloat(totalRaw);
  if (!Number.isFinite(total_amount) || total_amount < 0) {
    return { error: "Monto pactado inválido." };
  }

  const closedAtRaw = str(formData, "closed_at");
  const closed_at = closedAtRaw === "" ? new Date().toISOString() : closedAtRaw;

  const supabase = await createClient();

  // Resolver project_id + dueño del lead. El team_member_id de la venta SE
  // DERIVA del lead — el form no lo manda.
  const { data: leadData } = await supabase
    .from("leads")
    .select("project_id, team_member_id")
    .eq("id", leadId)
    .maybeSingle();
  const lead = leadData as {
    project_id: string;
    team_member_id: string | null;
  } | null;
  if (!lead || lead.project_id !== projectId) {
    return { error: "Lead inexistente o de otro proyecto." };
  }

  const insertPayload = {
    project_id: projectId,
    lead_id: leadId,
    team_member_id: lead.team_member_id,
    payment_modality_id,
    total_amount,
    closed_at,
  } as never;

  const { data, error } = await supabase
    .from("sales")
    .insert(insertPayload)
    .select("id")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      return { error: "Este lead ya tiene una venta registrada." };
    }
    return { error: error.message };
  }

  // Marcar lead cerrado (puede que ya lo esté; es idempotente).
  const leadUpdate = { status: "cerrado" } as never;
  await supabase
    .from("leads")
    .update(leadUpdate)
    .eq("id", leadId)
    .eq("project_id", projectId);

  revalidatePath(`/proyectos/${projectId}/leads`);
  const saleId = (data as { id: string } | null)?.id;
  return { ok: true, saleId };
}

export async function updateSale(
  projectId: string,
  saleId: string,
  _prev: SaleActionState,
  formData: FormData,
): Promise<SaleActionState> {
  await requireCanEditLaunchesIn(projectId);

  const payment_modality_id = str(formData, "payment_modality_id");
  if (!payment_modality_id) return { error: "Elegí una modalidad." };

  const totalRaw = str(formData, "total_amount");
  const total_amount = parseFloat(totalRaw);
  if (!Number.isFinite(total_amount) || total_amount < 0) {
    return { error: "Monto pactado inválido." };
  }
  const closedAtRaw = str(formData, "closed_at");

  const supabase = await createClient();

  // El dueño de la venta es el del lead — no se recibe del form. Mantenerlo
  // alineado preserva el invariante que el LB y el PDF asumen.
  const { data: saleRow } = await supabase
    .from("sales")
    .select("lead_id")
    .eq("id", saleId)
    .eq("project_id", projectId)
    .maybeSingle();
  const saleRef = saleRow as { lead_id: string } | null;
  if (!saleRef) return { error: "Venta inexistente." };
  const { data: leadRow } = await supabase
    .from("leads")
    .select("team_member_id")
    .eq("id", saleRef.lead_id)
    .maybeSingle();
  const team_member_id =
    (leadRow as { team_member_id: string | null } | null)?.team_member_id ?? null;

  const payload = {
    payment_modality_id,
    total_amount,
    team_member_id,
    ...(closedAtRaw && { closed_at: closedAtRaw }),
  } as never;

  const { error } = await supabase
    .from("sales")
    .update(payload)
    .eq("id", saleId)
    .eq("project_id", projectId);
  if (error) return { error: error.message };

  revalidatePath(`/proyectos/${projectId}/leads`);
  return { ok: true };
}

/**
 * Borra una sale. Los payments asociados caen por CASCADE (FK definida en
 * 0014). El lead NO se borra ni cambia de columna — el card del kanban queda
 * en `cerrado` sin venta, listo para que el usuario lo mueva a otra columna
 * si quiere. Decisión explícita: simétrico con "deletePayment no des-cierra
 * la venta", evita adivinar a qué estado revertir.
 *
 * Revalidamos también el launch detail (cobros/KPI) si el lead estaba ligado
 * a un launch — para que el revenue agregado se refleje al instante en lugar
 * de quedar con cache stale del SSR previo.
 */
export async function deleteSale(projectId: string, saleId: string): Promise<void> {
  await requireCanEditLaunchesIn(projectId);
  const supabase = await createClient();

  // Lookup del launch_id antes de borrar, para revalidar la tab de cobros.
  const { data: saleRow } = await supabase
    .from("sales")
    .select("lead_id, leads(launch_id)")
    .eq("id", saleId)
    .eq("project_id", projectId)
    .maybeSingle();
  const launchId =
    (saleRow as { leads: { launch_id: string | null } | null } | null)?.leads
      ?.launch_id ?? null;

  await supabase
    .from("sales")
    .delete()
    .eq("id", saleId)
    .eq("project_id", projectId);

  revalidatePath(`/proyectos/${projectId}/leads`);
  if (launchId) {
    revalidatePath(`/proyectos/${projectId}/launches/${launchId}`);
    revalidatePath(`/proyectos/${projectId}/launches/${launchId}/cobros`);
    revalidatePath(`/proyectos/${projectId}/launches/${launchId}/kpi`);
  }
}

// ─── payments ─────────────────────────────────────────────────────────────

export type PaymentActionState = { ok: true } | { error: string } | null;

/**
 * Revalida las rutas que dependen del par (sale, launch): kanban de leads,
 * tab de cobros y KPI del launch. Si la sale no está atada a un launch,
 * revalida sólo /leads. Mismo patrón que `deleteSale`.
 */
async function revalidateForSale(
  projectId: string,
  saleId: string,
): Promise<void> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sales")
    .select("lead_id, leads(launch_id)")
    .eq("id", saleId)
    .eq("project_id", projectId)
    .maybeSingle();
  const launchId =
    (data as { leads: { launch_id: string | null } | null } | null)?.leads
      ?.launch_id ?? null;

  revalidatePath(`/proyectos/${projectId}/leads`);
  if (launchId) {
    revalidatePath(`/proyectos/${projectId}/launches/${launchId}`);
    revalidatePath(`/proyectos/${projectId}/launches/${launchId}/cobros`);
    revalidatePath(`/proyectos/${projectId}/launches/${launchId}/kpi`);
  }
}

export async function addPayment(
  projectId: string,
  saleId: string,
  _prev: PaymentActionState,
  formData: FormData,
): Promise<PaymentActionState> {
  await requireCanEditLaunchesIn(projectId);

  const amountRaw = str(formData, "amount");
  const amount = parseFloat(amountRaw);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "El monto debe ser mayor a 0." };
  }
  const paidAt = str(formData, "paid_at");
  const notes = nullable(str(formData, "notes"));

  const supabase = await createClient();
  const payload = {
    sale_id: saleId,
    amount,
    ...(paidAt && { paid_at: paidAt }),
    notes,
  } as never;

  const { error } = await supabase.from("payments").insert(payload);
  if (error) return { error: error.message };

  await revalidateForSale(projectId, saleId);
  return { ok: true };
}

export async function deletePayment(
  projectId: string,
  paymentId: string,
): Promise<void> {
  await requireCanEditLaunchesIn(projectId);
  const supabase = await createClient();
  // Lookup del sale_id antes de borrar para poder revalidar la tab de cobros.
  const { data: paymentRow } = await supabase
    .from("payments")
    .select("sale_id")
    .eq("id", paymentId)
    .maybeSingle();
  const saleId = (paymentRow as { sale_id: string } | null)?.sale_id ?? null;

  await supabase.from("payments").delete().eq("id", paymentId);

  if (saleId) {
    await revalidateForSale(projectId, saleId);
  } else {
    revalidatePath(`/proyectos/${projectId}/leads`);
  }
}
