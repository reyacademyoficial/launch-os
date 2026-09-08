"use server";

import { revalidatePath } from "next/cache";

import { resolveCurrentOrganizationId } from "@/lib/organization/current";
import { isMarketingFormat, isWeekday } from "@/lib/marketing/types";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

// ═══════════════════════════════════════════════════════════════════════════
// CRUD de editor_availability (0164).
//
// Modelo: filas superpuestas permitidas (una persona puede tener un rango
// "disponible todo agosto" y otro "licencia 24-26"). La resolución de
// "está disponible el 2026-09-15?" vive en `src/lib/marketing/editor-load.ts`
// donde una regla de rango-más-específico gana.
// ═══════════════════════════════════════════════════════════════════════════

export type CreateAvailabilityState =
  | { ok: true; id: string }
  | { error: string }
  | null;

export type UpdateAvailabilityState = { ok: true } | { error: string } | null;

export type DeleteAvailabilityResult = { ok: true } | { error: string };

function nullIfEmpty(value: FormDataEntryValue | null): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length === 0 ? null : trimmed;
}

interface AvailabilityPayload {
  readonly personId: string;
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly available: boolean;
  readonly notes: string | null;
}

function parseFormData(formData: FormData): AvailabilityPayload | string {
  const personId = String(formData.get("person_id") ?? "").trim();
  if (personId.length === 0) return "Elegí una persona.";

  const dateFrom = String(formData.get("date_from") ?? "").trim();
  if (dateFrom.length === 0) return "La fecha de inicio es obligatoria.";

  const dateTo = String(formData.get("date_to") ?? "").trim();
  if (dateTo.length === 0) return "La fecha de fin es obligatoria.";

  if (dateTo < dateFrom) return "La fecha de fin no puede ser anterior a la de inicio.";

  const available = String(formData.get("available") ?? "true") === "true";

  const notes = nullIfEmpty(formData.get("notes"));

  return { personId, dateFrom, dateTo, available, notes };
}

// ═══════════════════════════════════════════════════════════════════════════
// createAvailability
// ═══════════════════════════════════════════════════════════════════════════

export async function createAvailability(
  _prev: CreateAvailabilityState,
  formData: FormData,
): Promise<CreateAvailabilityState> {
  const parsed = parseFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  let organizationId: string | null;
  try {
    organizationId = await resolveCurrentOrganizationId();
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Error resolviendo la organización.",
    };
  }
  if (!organizationId) {
    return { error: "No pudimos resolver tu organización. Revisá tus permisos." };
  }

  const supabase = await createSupabaseClient();
  const payload = {
    organization_id: organizationId,
    person_id: parsed.personId,
    date_from: parsed.dateFrom,
    date_to: parsed.dateTo,
    available: parsed.available,
    notes: parsed.notes,
  } as never;

  const { data, error } = await supabase
    .from("editor_availability")
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    if (error.code === "23514") {
      return {
        error:
          "El bloque rebotó un guard de coherencia. Verificá que la persona pertenece a tu organización.",
      };
    }
    return { error: error.message };
  }

  const created = data as { id: string } | null;
  if (!created) return { error: "El insert no devolvió fila." };

  revalidatePath("/marketing/disponibilidad");
  revalidatePath("/marketing/edicion");
  return { ok: true, id: created.id };
}

// ═══════════════════════════════════════════════════════════════════════════
// updateAvailability
// ═══════════════════════════════════════════════════════════════════════════

export async function updateAvailability(
  id: string,
  _prev: UpdateAvailabilityState,
  formData: FormData,
): Promise<UpdateAvailabilityState> {
  if (!id) return { error: "Falta el id del bloque." };

  const parsed = parseFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createSupabaseClient();
  const payload = {
    person_id: parsed.personId,
    date_from: parsed.dateFrom,
    date_to: parsed.dateTo,
    available: parsed.available,
    notes: parsed.notes,
  } as never;

  const { error } = await supabase
    .from("editor_availability")
    .update(payload)
    .eq("id", id);

  if (error) {
    if (error.code === "23514") {
      return {
        error:
          "El bloque rebotó un guard de coherencia. Verificá que la persona pertenece a tu organización.",
      };
    }
    return { error: error.message };
  }

  revalidatePath("/marketing/disponibilidad");
  revalidatePath("/marketing/edicion");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// deleteAvailability — hard delete (los bloques son "regla vigente", no historial).
// ═══════════════════════════════════════════════════════════════════════════

export async function deleteAvailability(
  id: string,
): Promise<DeleteAvailabilityResult> {
  if (!id) return { error: "Falta el id del bloque." };

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("editor_availability")
    .delete()
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/marketing/disponibilidad");
  revalidatePath("/marketing/edicion");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// CRUD de editor_weekly_schedule (0189) — horario semanal recurrente.
//
// `upsertWeeklySchedule` crea/actualiza VARIAS filas de una — una por cada
// día seleccionado, todas con el mismo horario. Simplifica el caso típico
// ("lunes a viernes 9 a 14") sin obligar a crear 5 bloques a mano. El
// conflicto (person_id, day_of_week) resuelve como upsert: reconfigurar un
// día ya cargado simplemente pisa el horario anterior.
// ═══════════════════════════════════════════════════════════════════════════

export type UpsertWeeklyScheduleState =
  | { ok: true }
  | { error: string }
  | null;

export type DeleteWeeklyScheduleResult = { ok: true } | { error: string };

function parseWeeklyScheduleFormData(formData: FormData):
  | {
      personId: string;
      days: number[];
      startTime: string;
      endTime: string;
      notes: string | null;
    }
  | string {
  const personId = String(formData.get("person_id") ?? "").trim();
  if (personId.length === 0) return "Elegí una persona.";

  const days = formData
    .getAll("day_of_week")
    .map((v) => Number.parseInt(String(v), 10))
    .filter((d) => isWeekday(d));
  if (days.length === 0) return "Elegí al menos un día de la semana.";

  const startTime = String(formData.get("start_time") ?? "").trim();
  const endTime = String(formData.get("end_time") ?? "").trim();
  if (startTime.length === 0 || endTime.length === 0) {
    return "El horario de inicio y fin son obligatorios.";
  }
  if (endTime <= startTime) {
    return "El horario de fin debe ser posterior al de inicio.";
  }

  const notes = nullIfEmpty(formData.get("notes"));

  return { personId, days, startTime, endTime, notes };
}

export async function upsertWeeklySchedule(
  _prev: UpsertWeeklyScheduleState,
  formData: FormData,
): Promise<UpsertWeeklyScheduleState> {
  const parsed = parseWeeklyScheduleFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  let organizationId: string | null;
  try {
    organizationId = await resolveCurrentOrganizationId();
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Error resolviendo la organización.",
    };
  }
  if (!organizationId) {
    return { error: "No pudimos resolver tu organización. Revisá tus permisos." };
  }

  const supabase = await createSupabaseClient();
  const payload = parsed.days.map((dayOfWeek) => ({
    organization_id: organizationId,
    person_id: parsed.personId,
    day_of_week: dayOfWeek,
    start_time: parsed.startTime,
    end_time: parsed.endTime,
    notes: parsed.notes,
  })) as never;

  const { error } = await supabase
    .from("editor_weekly_schedule")
    .upsert(payload, { onConflict: "person_id,day_of_week" });

  if (error) {
    if (error.code === "23514") {
      return {
        error:
          "El horario rebotó un guard de coherencia. Verificá que la persona pertenece a tu organización.",
      };
    }
    return { error: error.message };
  }

  revalidatePath("/marketing/disponibilidad");
  revalidatePath("/marketing/edicion");
  return { ok: true };
}

export type UpdateWeeklyScheduleResult = { ok: true } | { error: string };

// Edita POR ID: permite cambiar persona y/o día de una fila existente, no
// sólo el horario — si la nueva pareja (persona, día) ya tiene otra fila,
// el unique constraint rebota (23505).
export async function updateWeeklyScheduleRow(
  id: string,
  personId: string,
  dayOfWeek: number,
  startTime: string,
  endTime: string,
  notes: string | null,
): Promise<UpdateWeeklyScheduleResult> {
  if (!id) return { error: "Falta el id del horario." };
  if (!personId) return { error: "Elegí una persona." };
  if (!isWeekday(dayOfWeek)) return { error: "Día de la semana inválido." };
  if (!startTime || !endTime) {
    return { error: "El horario de inicio y fin son obligatorios." };
  }
  if (endTime <= startTime) {
    return { error: "El horario de fin debe ser posterior al de inicio." };
  }

  const supabase = await createSupabaseClient();
  const payload = {
    person_id: personId,
    day_of_week: dayOfWeek,
    start_time: startTime,
    end_time: endTime,
    notes: nullIfEmpty(notes),
  } as never;

  const { error } = await supabase
    .from("editor_weekly_schedule")
    .update(payload)
    .eq("id", id);

  if (error) {
    if (error.code === "23505") {
      return {
        error:
          "Esa persona ya tiene un horario configurado para ese día. Editá el existente en vez de duplicarlo.",
      };
    }
    return { error: error.message };
  }

  revalidatePath("/marketing/disponibilidad");
  revalidatePath("/marketing/edicion");
  return { ok: true };
}

export async function deleteWeeklyScheduleRow(
  id: string,
): Promise<DeleteWeeklyScheduleResult> {
  if (!id) return { error: "Falta el id del horario." };

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("editor_weekly_schedule")
    .delete()
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/marketing/disponibilidad");
  revalidatePath("/marketing/edicion");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// CRUD de editor_format_capacity (0190) — máximo de piezas por formato que
// un editor puede terminar en un día completo. PK natural (person_id,
// format) — mismo patrón de upsert que publishing_cadences.
// ═══════════════════════════════════════════════════════════════════════════

export type UpsertFormatCapacityState =
  | { ok: true }
  | { error: string }
  | null;

export type DeleteFormatCapacityResult = { ok: true } | { error: string };

interface FormatCapacityPayload {
  readonly personId: string;
  readonly format: string;
  readonly maxPerDay: number;
}

function parseFormatCapacityFormData(
  formData: FormData,
): FormatCapacityPayload | string {
  const personId = String(formData.get("person_id") ?? "").trim();
  if (personId.length === 0) return "Elegí una persona.";

  const format = String(formData.get("format") ?? "").trim();
  if (!isMarketingFormat(format)) return "Formato inválido.";

  const maxPerDayRaw = String(formData.get("max_per_day") ?? "").trim();
  const maxPerDay = Number.parseInt(maxPerDayRaw, 10);
  if (!Number.isFinite(maxPerDay) || maxPerDay <= 0) {
    return "El máximo por día debe ser un número entero mayor a 0.";
  }
  if (maxPerDay > 200) {
    return "El máximo por día parece demasiado alto (máximo 200).";
  }

  return { personId, format, maxPerDay };
}

export async function upsertFormatCapacity(
  _prev: UpsertFormatCapacityState,
  formData: FormData,
): Promise<UpsertFormatCapacityState> {
  const parsed = parseFormatCapacityFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  let organizationId: string | null;
  try {
    organizationId = await resolveCurrentOrganizationId();
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Error resolviendo la organización.",
    };
  }
  if (!organizationId) {
    return { error: "No pudimos resolver tu organización. Revisá tus permisos." };
  }

  const supabase = await createSupabaseClient();
  const payload = {
    organization_id: organizationId,
    person_id: parsed.personId,
    format: parsed.format,
    max_per_day: parsed.maxPerDay,
  } as never;

  const { error } = await supabase
    .from("editor_format_capacity")
    .upsert(payload, { onConflict: "person_id,format" });

  if (error) {
    if (error.code === "23514") {
      return {
        error:
          "La capacidad rebotó un guard de coherencia. Verificá que la persona pertenece a tu organización.",
      };
    }
    return { error: error.message };
  }

  revalidatePath("/marketing/disponibilidad");
  revalidatePath("/marketing/edicion");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// updateFormatCapacity — a diferencia de `upsertFormatCapacity` (create),
// esto edita POR ID: permite cambiar persona y/o formato de una capacidad
// existente sin tener que borrarla y crearla de nuevo. Si la nueva pareja
// (persona, formato) ya tiene otra fila, el unique constraint rebota (23505).
// ═══════════════════════════════════════════════════════════════════════════

export async function updateFormatCapacity(
  id: string,
  _prev: UpsertFormatCapacityState,
  formData: FormData,
): Promise<UpsertFormatCapacityState> {
  if (!id) return { error: "Falta el id de la capacidad." };

  const parsed = parseFormatCapacityFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createSupabaseClient();
  const payload = {
    person_id: parsed.personId,
    format: parsed.format,
    max_per_day: parsed.maxPerDay,
  } as never;

  const { error } = await supabase
    .from("editor_format_capacity")
    .update(payload)
    .eq("id", id);

  if (error) {
    if (error.code === "23505") {
      return {
        error:
          "Esa persona ya tiene una capacidad configurada para ese formato. Editá la existente en vez de duplicarla.",
      };
    }
    if (error.code === "23514") {
      return {
        error:
          "La capacidad rebotó un guard de coherencia. Verificá que la persona pertenece a tu organización.",
      };
    }
    return { error: error.message };
  }

  revalidatePath("/marketing/disponibilidad");
  revalidatePath("/marketing/edicion");
  return { ok: true };
}

export async function deleteFormatCapacity(id: string): Promise<DeleteFormatCapacityResult> {
  if (!id) return { error: "Falta el id de la capacidad." };

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("editor_format_capacity")
    .delete()
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/marketing/disponibilidad");
  revalidatePath("/marketing/edicion");
  return { ok: true };
}
