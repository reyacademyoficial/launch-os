"use server";

import { revalidatePath } from "next/cache";

import { resolveCurrentOrganizationId } from "@/lib/organization/current";
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
