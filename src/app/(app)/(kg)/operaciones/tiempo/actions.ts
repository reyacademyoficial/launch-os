"use server";

import { revalidatePath } from "next/cache";

import { createClient as createSupabaseClient } from "@/lib/supabase/server";

// ═══════════════════════════════════════════════════════════════════════════
// CRUD de time_entries (bloque 5 · 0096).
//
// Asiento contable post-facto (NO cronómetro). person_id + minutes son
// obligatorios. task_id y internal_project_id son opcionales e
// independientes — sin XOR: puede haber 0, 1 o 2 (una tarea dentro de un
// proyecto → ambos seteados).
//
// person_id.on_delete = RESTRICT en DB: bloquea borrar personas con
// historial de horas. Es dato contable (alimenta payroll y reporting).
//
// Delete es hard con confirm — los time_entries son leaf, sin dependientes.
// Es la única forma de corregir un asiento cargado mal. Los reportes
// históricos se recalculan sobre el conjunto vigente.
// ═══════════════════════════════════════════════════════════════════════════

export type CreateTimeEntryState =
  | { ok: true; entryId: string }
  | { error: string }
  | null;

export type UpdateTimeEntryState = { ok: true } | { error: string } | null;

export type DeleteTimeEntryResult = { ok: true } | { error: string };

const YMD_RX = /^\d{4}-\d{2}-\d{2}$/;

function nullIfEmpty(value: FormDataEntryValue | null): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length === 0 ? null : trimmed;
}

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

interface TimeEntryPayload {
  readonly personId: string;
  readonly minutes: number;
  readonly loggedOn: string;
  readonly taskId: string | null;
  readonly internalProjectId: string | null;
  readonly notes: string | null;
}

/**
 * Parsea `hours` o `minutes` del form (el drawer acepta las dos y las
 * convierte). Devuelve minutos enteros > 0.
 */
function parseMinutes(formData: FormData): number | string {
  const minutesRaw = String(formData.get("minutes") ?? "").trim();
  const minutes = Number(minutesRaw);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return "Los minutos tienen que ser un número mayor a 0.";
  }
  return Math.round(minutes);
}

function parseTimeEntryFormData(
  formData: FormData,
): TimeEntryPayload | string {
  const personId = nullIfEmpty(formData.get("person_id"));
  if (personId == null) return "Elegí la persona.";

  const parsedMinutes = parseMinutes(formData);
  if (typeof parsedMinutes === "string") return parsedMinutes;

  const loggedOnRaw = nullIfEmpty(formData.get("logged_on"));
  const loggedOn = loggedOnRaw ?? todayYmd();
  if (!YMD_RX.test(loggedOn)) return "La fecha no es válida.";

  const taskId = nullIfEmpty(formData.get("task_id"));
  const internalProjectId = nullIfEmpty(formData.get("internal_project_id"));

  const notes = nullIfEmpty(formData.get("notes"));

  return {
    personId,
    minutes: parsedMinutes,
    loggedOn,
    taskId,
    internalProjectId,
    notes,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// createTimeEntry
// ═══════════════════════════════════════════════════════════════════════════

export async function createTimeEntry(
  _prev: CreateTimeEntryState,
  formData: FormData,
): Promise<CreateTimeEntryState> {
  const parsed = parseTimeEntryFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createSupabaseClient();
  const payload = {
    person_id: parsed.personId,
    minutes: parsed.minutes,
    logged_on: parsed.loggedOn,
    task_id: parsed.taskId,
    internal_project_id: parsed.internalProjectId,
    notes: parsed.notes,
  } as never;

  const { data, error } = await supabase
    .from("time_entries")
    .insert(payload)
    .select("id")
    .single();

  if (error) return { error: error.message };

  const created = data as { id: string } | null;
  if (!created) return { error: "El insert no devolvió fila." };

  revalidatePath("/operaciones/tiempo");
  revalidatePath("/operaciones");
  if (parsed.internalProjectId) {
    revalidatePath(`/operaciones/proyectos/${parsed.internalProjectId}`);
  }
  return { ok: true, entryId: created.id };
}

// ═══════════════════════════════════════════════════════════════════════════
// updateTimeEntry
// ═══════════════════════════════════════════════════════════════════════════

export async function updateTimeEntry(
  entryId: string,
  _prev: UpdateTimeEntryState,
  formData: FormData,
): Promise<UpdateTimeEntryState> {
  if (!entryId) return { error: "Falta el id del registro." };

  const parsed = parseTimeEntryFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createSupabaseClient();

  const { data: existing } = await supabase
    .from("time_entries")
    .select("internal_project_id")
    .eq("id", entryId)
    .maybeSingle();
  const prevProjectId =
    (existing as { internal_project_id: string | null } | null)
      ?.internal_project_id ?? null;

  const payload = {
    person_id: parsed.personId,
    minutes: parsed.minutes,
    logged_on: parsed.loggedOn,
    task_id: parsed.taskId,
    internal_project_id: parsed.internalProjectId,
    notes: parsed.notes,
  } as never;

  const { error } = await supabase
    .from("time_entries")
    .update(payload)
    .eq("id", entryId);

  if (error) return { error: error.message };

  revalidatePath("/operaciones/tiempo");
  revalidatePath("/operaciones");
  if (parsed.internalProjectId) {
    revalidatePath(`/operaciones/proyectos/${parsed.internalProjectId}`);
  }
  if (prevProjectId && prevProjectId !== parsed.internalProjectId) {
    revalidatePath(`/operaciones/proyectos/${prevProjectId}`);
  }
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// deleteTimeEntry
// ═══════════════════════════════════════════════════════════════════════════

export async function deleteTimeEntry(
  entryId: string,
): Promise<DeleteTimeEntryResult> {
  if (!entryId) return { error: "Falta el id del registro." };

  const supabase = await createSupabaseClient();

  const { data: existing } = await supabase
    .from("time_entries")
    .select("internal_project_id")
    .eq("id", entryId)
    .maybeSingle();
  const projectId =
    (existing as { internal_project_id: string | null } | null)
      ?.internal_project_id ?? null;

  const { error } = await supabase
    .from("time_entries")
    .delete()
    .eq("id", entryId);
  if (error) return { error: error.message };

  revalidatePath("/operaciones/tiempo");
  revalidatePath("/operaciones");
  if (projectId) revalidatePath(`/operaciones/proyectos/${projectId}`);
  return { ok: true };
}
