"use server";

import { revalidatePath } from "next/cache";

import type { RelationshipStatus } from "@/lib/clients/types";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

// ═══════════════════════════════════════════════════════════════════════════
// Actions de la ficha del cliente. Atar / desatar projects + health CRUD.
//
// Un project pertenece a lo sumo a UN cliente (projects.client_id nullable
// en 0110). Para "mover" un project entre clientes, primero se desata del
// actual y después se ata al nuevo — no hay reasignación directa. Es
// consciente: reduce la superficie de errores accidentales.
//
// project_health tiene unique(client_id) — 1 fila por cliente. El action
// es UPSERT: si no hay fila, crea; si hay, actualiza. El trigger
// project_health_set_org_from_client rellena organization_id desde
// clients, así que el operador no lo pasa.
// ═══════════════════════════════════════════════════════════════════════════

export type AttachProjectResult = { ok: true } | { error: string };

export type DetachProjectResult = { ok: true } | { error: string };

export type UpsertHealthState = { ok: true } | { error: string } | null;

export type ResetHealthResult = { ok: true } | { error: string };

const RELATIONSHIP_STATUSES: readonly RelationshipStatus[] = [
  "onboarding",
  "activa",
  "en_riesgo",
  "perdida",
];

// ═══════════════════════════════════════════════════════════════════════════
// attachProjectToClient — asocia un project al cliente
//
// Guard: el project TIENE que estar sin cliente atado. Si ya pertenece a
// otro cliente, rebota. El operador tiene que ir al otro cliente y
// desatarlo primero. Esta política evita que un click accidental mueva
// silenciosamente un project que pertenece a otro cliente.
// ═══════════════════════════════════════════════════════════════════════════

export async function attachProjectToClient(
  clientId: string,
  projectId: string,
): Promise<AttachProjectResult> {
  if (!clientId) return { error: "Falta el id del cliente." };
  if (!projectId) return { error: "Falta el id del project." };

  const supabase = await createSupabaseClient();

  const { data: current, error: readErr } = await supabase
    .from("projects")
    .select("id, name, client_id")
    .eq("id", projectId)
    .maybeSingle();

  if (readErr) return { error: readErr.message };
  const row = current as
    | { id: string; name: string; client_id: string | null }
    | null;
  if (!row) {
    return {
      error: "El project ya no existe o no tenés acceso. Recargá y reintentá.",
    };
  }
  if (row.client_id === clientId) {
    // Idempotencia — si alguien re-clickea, no dolemos.
    return { ok: true };
  }
  if (row.client_id != null) {
    return {
      error:
        `El project "${row.name}" ya está atado a otro cliente. Desatalo desde ese cliente antes de reatarlo acá.`,
    };
  }

  const payload = { client_id: clientId } as never;
  const { error } = await supabase
    .from("projects")
    .update(payload)
    .eq("id", projectId);
  if (error) return { error: error.message };

  revalidatePath(`/clientes/${clientId}`);
  revalidatePath("/clientes");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// detachProjectFromClient — quita la atadura (client_id = null)
//
// No borra el project — solo la referencia. El project sigue existiendo
// en LaunchOS con toda su información; deja de aparecer en la ficha del
// cliente y puede reatarse a otro cliente después.
// ═══════════════════════════════════════════════════════════════════════════

export async function detachProjectFromClient(
  projectId: string,
): Promise<DetachProjectResult> {
  if (!projectId) return { error: "Falta el id del project." };

  const supabase = await createSupabaseClient();

  // Leo el client_id actual para invalidar la ruta correcta.
  const { data: current } = await supabase
    .from("projects")
    .select("client_id")
    .eq("id", projectId)
    .maybeSingle();
  const previousClientId =
    (current as { client_id: string | null } | null)?.client_id ?? null;

  const payload = { client_id: null } as never;
  const { error } = await supabase
    .from("projects")
    .update(payload)
    .eq("id", projectId);
  if (error) return { error: error.message };

  if (previousClientId) {
    revalidatePath(`/clientes/${previousClientId}`);
  }
  revalidatePath("/clientes");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// upsertProjectHealth — crea o edita el health del cliente
//
// health_score: opcional. Si viene vacío se guarda null (score compuesto se
// deriva de NPS + contacto + tickets en un selector — cuando esté). Si
// viene numérico entre 0 y 100 se guarda como override manual.
//
// last_contact_at: si viene fecha, se guarda como timestamp del día a las
// 12:00 UTC (mediodía) — evita corrimientos de día por timezone en la UI.
// ═══════════════════════════════════════════════════════════════════════════

interface HealthPayload {
  readonly relationshipStatus: RelationshipStatus;
  readonly healthScore: number | null;
  readonly lastContactAt: string | null;
  readonly notes: string | null;
}

function nullIfEmpty(value: FormDataEntryValue | null): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length === 0 ? null : trimmed;
}

const YMD_RX = /^\d{4}-\d{2}-\d{2}$/;

function parseHealthFormData(formData: FormData): HealthPayload | string {
  const statusRaw = String(formData.get("relationship_status") ?? "").trim();
  if (!(RELATIONSHIP_STATUSES as readonly string[]).includes(statusRaw)) {
    return "Estado de relación inválido.";
  }
  const relationshipStatus = statusRaw as RelationshipStatus;

  const scoreRaw = nullIfEmpty(formData.get("health_score"));
  let healthScore: number | null = null;
  if (scoreRaw != null) {
    const n = Number(scoreRaw);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      return "El health score tiene que ser un número entre 0 y 100 (o dejarlo vacío para que se calcule solo).";
    }
    healthScore = Math.round(n);
  }

  const lastContactDate = nullIfEmpty(formData.get("last_contact_at"));
  let lastContactAt: string | null = null;
  if (lastContactDate != null) {
    if (!YMD_RX.test(lastContactDate)) {
      return "La fecha del último contacto no es válida.";
    }
    // Mediodía UTC para no rebotar de día por timezone.
    lastContactAt = `${lastContactDate}T12:00:00Z`;
  }

  const notes = nullIfEmpty(formData.get("notes"));

  return { relationshipStatus, healthScore, lastContactAt, notes };
}

export async function upsertProjectHealth(
  clientId: string,
  _prev: UpsertHealthState,
  formData: FormData,
): Promise<UpsertHealthState> {
  if (!clientId) return { error: "Falta el id del cliente." };

  const parsed = parseHealthFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createSupabaseClient();
  const payload = {
    client_id: clientId,
    relationship_status: parsed.relationshipStatus,
    health_score: parsed.healthScore,
    last_contact_at: parsed.lastContactAt,
    notes: parsed.notes,
  } as never;

  // Upsert por client_id (unique en 0110). El trigger
  // project_health_set_org_from_client rellena organization_id.
  const { error } = await supabase
    .from("project_health")
    .upsert(payload, { onConflict: "client_id" });
  if (error) return { error: error.message };

  revalidatePath(`/clientes/${clientId}`);
  revalidatePath("/clientes");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// resetProjectHealth — borra la fila de health del cliente.
//
// Vuelve al estado "sin health cargada". No es lo mismo que setear
// relationship_status='onboarding' — resetear implica que no queremos
// tener ningún dato de relación registrado por ahora. Usar con criterio.
// ═══════════════════════════════════════════════════════════════════════════

export async function resetProjectHealth(
  clientId: string,
): Promise<ResetHealthResult> {
  if (!clientId) return { error: "Falta el id del cliente." };

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("project_health")
    .delete()
    .eq("client_id", clientId);
  if (error) return { error: error.message };

  revalidatePath(`/clientes/${clientId}`);
  revalidatePath("/clientes");
  return { ok: true };
}
