"use server";

import { revalidatePath } from "next/cache";

import { resolveCurrentOrganizationId } from "@/lib/organization/current";
import { requireRole } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

// ═══════════════════════════════════════════════════════════════════════════
// Contratos de retorno — patrón discriminated union del resto de la app
// ═══════════════════════════════════════════════════════════════════════════
export type CreatePersonState =
  | { ok: true; personId: string }
  | { error: string }
  | null;

export type UpdatePersonState = { ok: true } | { error: string } | null;

// ═══════════════════════════════════════════════════════════════════════════
// Helpers privados
// ═══════════════════════════════════════════════════════════════════════════
function nullIfEmpty(value: FormDataEntryValue | null): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Parsea el monthly_salary del form. Acepta vacío → 0 (persona sin sueldo
 * cargado todavía). No-numérico → 0 con error controlado arriba. Nunca null:
 * la columna es NOT NULL con default 0 en 0109.
 */
function parseSalary(value: FormDataEntryValue | null): number {
  const raw = String(value ?? "").trim();
  if (raw.length === 0) return 0;
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function parseSalaryCurrency(value: FormDataEntryValue | null): "ARS" | "USD" {
  return String(value ?? "").trim() === "USD" ? "USD" : "ARS";
}

// ═══════════════════════════════════════════════════════════════════════════
// createPerson
// ═══════════════════════════════════════════════════════════════════════════
export async function createPerson(
  _prev: CreatePersonState,
  formData: FormData,
): Promise<CreatePersonState> {
  await requireRole("superadmin");

  const fullName = String(formData.get("full_name") ?? "").trim();
  if (fullName.length === 0) {
    return { error: "El nombre completo es obligatorio." };
  }

  const nationalId = nullIfEmpty(formData.get("national_id"));
  const emailRaw = nullIfEmpty(formData.get("email"));
  const email = emailRaw ? emailRaw.toLowerCase() : null;
  const phone = nullIfEmpty(formData.get("phone"));
  const notes = nullIfEmpty(formData.get("notes"));
  const monthlySalary = parseSalary(formData.get("monthly_salary"));
  const salaryCurrency = parseSalaryCurrency(formData.get("salary_currency"));

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

  const supabase = await createClient();
  const payload = {
    organization_id: organizationId,
    full_name: fullName,
    national_id: nationalId,
    email,
    phone,
    notes,
    monthly_salary: monthlySalary,
    salary_currency: salaryCurrency,
  } as never;

  const { data, error } = await supabase
    .from("organization_people")
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    // Duplicado por (organization_id, national_id): unique parcial de 0058.
    if (error.code === "23505") {
      return {
        error: "Ya existe una persona con ese documento en la organización.",
      };
    }
    return { error: error.message };
  }

  const created = data as { id: string } | null;
  if (!created) return { error: "El insert no devolvió fila." };

  revalidatePath("/organizacion/personas");
  return { ok: true, personId: created.id };
}

// ═══════════════════════════════════════════════════════════════════════════
// updatePerson
// ═══════════════════════════════════════════════════════════════════════════
export async function updatePerson(
  personId: string,
  _prev: UpdatePersonState,
  formData: FormData,
): Promise<UpdatePersonState> {
  await requireRole("superadmin");

  const fullName = String(formData.get("full_name") ?? "").trim();
  if (fullName.length === 0) {
    return { error: "El nombre completo es obligatorio." };
  }

  const nationalId = nullIfEmpty(formData.get("national_id"));
  const emailRaw = nullIfEmpty(formData.get("email"));
  const email = emailRaw ? emailRaw.toLowerCase() : null;
  const phone = nullIfEmpty(formData.get("phone"));
  const notes = nullIfEmpty(formData.get("notes"));
  const monthlySalary = parseSalary(formData.get("monthly_salary"));
  const salaryCurrency = parseSalaryCurrency(formData.get("salary_currency"));

  // auth_user_id (migración 0111). Vincula esta persona con un usuario Kingrow.
  // Vacío = desvincular. El unique de la columna rechaza si el user ya está
  // vinculado a otra persona → traducimos a mensaje amable.
  const authUserIdRaw = nullIfEmpty(formData.get("auth_user_id"));
  const authUserId = authUserIdRaw;

  const supabase = await createClient();
  const payload = {
    full_name: fullName,
    national_id: nationalId,
    email,
    phone,
    notes,
    monthly_salary: monthlySalary,
    salary_currency: salaryCurrency,
    auth_user_id: authUserId,
  } as never;

  const { error } = await supabase
    .from("organization_people")
    .update(payload)
    .eq("id", personId);

  if (error) {
    if (error.code === "23505") {
      // El unique puede rebotar por (org, national_id) — persona duplicada
      // — o por auth_user_id — usuario ya vinculado a otra persona. El
      // mensaje detalla ambas.
      return {
        error:
          "Ya existe otra persona con ese documento en la organización, o " +
          "el usuario Kingrow seleccionado ya está vinculado a otra persona.",
      };
    }
    return { error: error.message };
  }

  revalidatePath("/organizacion/personas");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// deactivate + reactivate — soft delete via `active` flag. No hay hard delete:
// payroll y time_entries referencian con ON DELETE RESTRICT, así que borrar
// una persona con historial rompe la FK. El toggle es reversible.
// ═══════════════════════════════════════════════════════════════════════════
export async function deactivatePerson(personId: string): Promise<void> {
  await requireRole("superadmin");
  const supabase = await createClient();
  const payload = { active: false } as never;
  await supabase
    .from("organization_people")
    .update(payload)
    .eq("id", personId);
  revalidatePath("/organizacion/personas");
}

export async function reactivatePerson(personId: string): Promise<void> {
  await requireRole("superadmin");
  const supabase = await createClient();
  const payload = { active: true } as never;
  await supabase
    .from("organization_people")
    .update(payload)
    .eq("id", personId);
  revalidatePath("/organizacion/personas");
}
