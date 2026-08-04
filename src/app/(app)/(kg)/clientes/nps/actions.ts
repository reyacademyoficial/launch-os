"use server";

import { revalidatePath } from "next/cache";

import { createClient as createSupabaseClient } from "@/lib/supabase/server";

// ═══════════════════════════════════════════════════════════════════════════
// CRUD de nps_responses (bloque 3 · 0081/0110).
//
// El shape es simple — un score 0-10 + metadatos. Sin invariantes duros,
// solo el CHECK del score. No hay status ni transiciones. Editar una
// respuesta cambia el histórico de la encuesta — se permite igual (para
// typos), con confirm para delete.
//
// El score se guarda como número entero. La clasificación
// (promoter/passive/detractor) vive en TS (classifyNps de src/lib/clients/
// health.ts) para poder recalcularla si cambia el criterio.
// ═══════════════════════════════════════════════════════════════════════════

export type CreateNpsState =
  | { ok: true; npsId: string }
  | { error: string }
  | null;

export type UpdateNpsState = { ok: true } | { error: string } | null;

export type DeleteNpsResult = { ok: true } | { error: string };

const YMD_RX = /^\d{4}-\d{2}-\d{2}$/;

function nullIfEmpty(value: FormDataEntryValue | null): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length === 0 ? null : trimmed;
}

interface NpsPayload {
  readonly clientId: string;
  readonly respondentName: string | null;
  readonly respondentEmail: string | null;
  readonly score: number;
  readonly comment: string | null;
  readonly channel: string | null;
  /** ISO timestamp — construido a partir de la fecha del form + mediodía UTC. */
  readonly respondedAt: string;
}

function parseNpsFormData(formData: FormData): NpsPayload | string {
  const clientId = String(formData.get("client_id") ?? "").trim();
  if (clientId.length === 0) return "Elegí un cliente.";

  const respondentName = nullIfEmpty(formData.get("respondent_name"));
  const emailRaw = nullIfEmpty(formData.get("respondent_email"));
  const respondentEmail = emailRaw ? emailRaw.toLowerCase() : null;

  const scoreRaw = String(formData.get("score") ?? "").trim();
  if (scoreRaw.length === 0) return "El score es obligatorio.";
  const scoreNum = Number(scoreRaw);
  if (!Number.isFinite(scoreNum) || scoreNum < 0 || scoreNum > 10) {
    return "El score tiene que ser un número entre 0 y 10.";
  }
  const score = Math.round(scoreNum);

  const comment = nullIfEmpty(formData.get("comment"));
  const channel = nullIfEmpty(formData.get("channel"));

  const respondedDateRaw = nullIfEmpty(formData.get("responded_at"));
  let respondedAt: string;
  if (respondedDateRaw != null) {
    if (!YMD_RX.test(respondedDateRaw)) {
      return "La fecha de la respuesta no es válida.";
    }
    // Mediodía UTC para no rebotar de día por timezone (mismo criterio
    // que project_health.last_contact_at).
    respondedAt = `${respondedDateRaw}T12:00:00Z`;
  } else {
    respondedAt = new Date().toISOString();
  }

  return {
    clientId,
    respondentName,
    respondentEmail,
    score,
    comment,
    channel,
    respondedAt,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// createNps
// ═══════════════════════════════════════════════════════════════════════════

export async function createNps(
  _prev: CreateNpsState,
  formData: FormData,
): Promise<CreateNpsState> {
  const parsed = parseNpsFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createSupabaseClient();
  const payload = {
    client_id: parsed.clientId,
    respondent_name: parsed.respondentName,
    respondent_email: parsed.respondentEmail,
    score: parsed.score,
    comment: parsed.comment,
    channel: parsed.channel,
    responded_at: parsed.respondedAt,
  } as never;

  const { data, error } = await supabase
    .from("nps_responses")
    .insert(payload)
    .select("id")
    .single();

  if (error) return { error: error.message };

  const created = data as { id: string } | null;
  if (!created) return { error: "El insert no devolvió fila." };

  revalidatePath("/clientes/nps");
  revalidatePath("/clientes");
  revalidatePath(`/clientes/${parsed.clientId}`);
  return { ok: true, npsId: created.id };
}

// ═══════════════════════════════════════════════════════════════════════════
// updateNps
// ═══════════════════════════════════════════════════════════════════════════

export async function updateNps(
  npsId: string,
  _prev: UpdateNpsState,
  formData: FormData,
): Promise<UpdateNpsState> {
  if (!npsId) return { error: "Falta el id de la respuesta." };

  const parsed = parseNpsFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createSupabaseClient();

  const { data: existing } = await supabase
    .from("nps_responses")
    .select("client_id")
    .eq("id", npsId)
    .maybeSingle();
  const prevClientId =
    (existing as { client_id: string } | null)?.client_id ?? null;

  const payload = {
    client_id: parsed.clientId,
    respondent_name: parsed.respondentName,
    respondent_email: parsed.respondentEmail,
    score: parsed.score,
    comment: parsed.comment,
    channel: parsed.channel,
    responded_at: parsed.respondedAt,
  } as never;

  const { error } = await supabase
    .from("nps_responses")
    .update(payload)
    .eq("id", npsId);

  if (error) return { error: error.message };

  revalidatePath("/clientes/nps");
  revalidatePath("/clientes");
  revalidatePath(`/clientes/${parsed.clientId}`);
  if (prevClientId && prevClientId !== parsed.clientId) {
    revalidatePath(`/clientes/${prevClientId}`);
  }
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// deleteNps
// ═══════════════════════════════════════════════════════════════════════════

export async function deleteNps(npsId: string): Promise<DeleteNpsResult> {
  if (!npsId) return { error: "Falta el id de la respuesta." };

  const supabase = await createSupabaseClient();

  const { data: existing } = await supabase
    .from("nps_responses")
    .select("client_id")
    .eq("id", npsId)
    .maybeSingle();
  const clientId = (existing as { client_id: string } | null)?.client_id;

  const { error } = await supabase
    .from("nps_responses")
    .delete()
    .eq("id", npsId);
  if (error) return { error: error.message };

  revalidatePath("/clientes/nps");
  revalidatePath("/clientes");
  if (clientId) revalidatePath(`/clientes/${clientId}`);
  return { ok: true };
}
