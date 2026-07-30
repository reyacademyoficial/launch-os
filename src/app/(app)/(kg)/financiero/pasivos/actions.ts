"use server";

import { revalidatePath } from "next/cache";

import { isValidLiabilityType } from "@/lib/finance/liability-types";
import { resolveCurrentOrganizationId } from "@/lib/organization/current";
import { requireRole } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

import { translateLiabilityError } from "./translate-error";

// ═══════════════════════════════════════════════════════════════════════════
// Contratos de retorno
// ═══════════════════════════════════════════════════════════════════════════

export type CreateLiabilityState =
  | { ok: true; liabilityId: string }
  | { error: string }
  | null;

export type UpdateLiabilityState = { ok: true } | { error: string } | null;

export type ToggleLiabilityActiveResult = { ok: true } | { error: string };

// ═══════════════════════════════════════════════════════════════════════════
// Payload compartido create/update
// ═══════════════════════════════════════════════════════════════════════════
//
// settled_at es CAMPO del form (no flujo separado tipo mark-paid). Razón:
// a diferencia de expenses, un pasivo puede saldarse sin bank_movement
// (refinanciación, compensación con AR, etc.), así que exigir un link
// dificulta el caso normal. El humano edita la fecha directamente; el CHECK
// de DB valida `active` y `settled_at IS NULL` como condición de "vigente".

interface LiabilityPayload {
  readonly name: string;
  readonly liabilityType: string;
  readonly description: string | null;
  readonly amount: number;
  readonly currency: string;
  readonly incurredAt: string | null;
  readonly dueDate: string | null;
  readonly settledAt: string | null;
  readonly notes: string | null;
}

function parseLiabilityFormData(formData: FormData): LiabilityPayload | string {
  const name = String(formData.get("name") ?? "").trim();
  if (name.length === 0) return "El nombre del pasivo es obligatorio.";

  const typeRaw = String(formData.get("liability_type") ?? "").trim();
  if (!isValidLiabilityType(typeRaw)) {
    return "Elegí un tipo de pasivo válido.";
  }
  const liabilityType = typeRaw;

  const description = nullIfEmpty(formData.get("description"));

  const amount = Number(formData.get("amount"));
  if (!Number.isFinite(amount) || amount < 0) {
    return "El monto tiene que ser un número positivo o 0.";
  }

  const currencyRaw = String(formData.get("currency") ?? "ARS").trim().toUpperCase();
  const currency = currencyRaw.length > 0 ? currencyRaw : "ARS";

  const incurredAt = ymdOrNull(formData.get("incurred_at"));
  if (incurredAt === "invalid") return "La fecha de incurrido no es válida.";

  const dueDate = ymdOrNull(formData.get("due_date"));
  if (dueDate === "invalid") return "La fecha de vencimiento no es válida.";

  const settledAt = ymdOrNull(formData.get("settled_at"));
  if (settledAt === "invalid") return "La fecha de saldado no es válida.";

  const notes = nullIfEmpty(formData.get("notes"));

  return {
    name,
    liabilityType,
    description,
    amount,
    currency,
    incurredAt,
    dueDate,
    settledAt,
    notes,
  };
}

function nullIfEmpty(value: FormDataEntryValue | null): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Devuelve YYYY-MM-DD, null si vacío, o el sentinel "invalid" para que el
 * caller emita el mensaje específico del campo. Usar un sentinel evita
 * lanzar excepciones desde el parser.
 */
function ymdOrNull(value: FormDataEntryValue | null): string | null | "invalid" {
  const s = String(value ?? "").trim();
  if (s.length === 0) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "invalid";
  return s;
}

// ═══════════════════════════════════════════════════════════════════════════
// createLiability
// ═══════════════════════════════════════════════════════════════════════════

export async function createLiability(
  _prev: CreateLiabilityState,
  formData: FormData,
): Promise<CreateLiabilityState> {
  await requireRole("superadmin");

  const parsed = parseLiabilityFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  let organizationId: string | null;
  try {
    organizationId = await resolveCurrentOrganizationId();
  } catch (e) {
    return {
      error:
        e instanceof Error ? e.message : "Error resolviendo la organización.",
    };
  }
  if (!organizationId) {
    return { error: "No pudimos resolver tu organización. Revisá tus permisos." };
  }

  const supabase = await createClient();
  const payload = {
    organization_id: organizationId,
    name: parsed.name,
    liability_type: parsed.liabilityType,
    description: parsed.description,
    account_id: null,
    amount: parsed.amount,
    currency: parsed.currency,
    incurred_at: parsed.incurredAt,
    due_date: parsed.dueDate,
    settled_at: parsed.settledAt,
    active: true,
    notes: parsed.notes,
  } as never;

  const { data, error } = await supabase
    .from("liabilities")
    .insert(payload)
    .select("id")
    .single();

  if (error) return { error: translateLiabilityError(error) };

  const created = data as { id: string } | null;
  if (!created) return { error: "El insert no devolvió fila." };

  revalidatePath("/financiero/pasivos");
  // Los pasivos vigentes (active AND settled_at IS NULL) alimentan el
  // Patrimonio neto — revalidar el dashboard.
  revalidatePath("/financiero");
  return { ok: true, liabilityId: created.id };
}

// ═══════════════════════════════════════════════════════════════════════════
// updateLiability — mantiene `active` intacto
// ═══════════════════════════════════════════════════════════════════════════

export async function updateLiability(
  liabilityId: string,
  _prev: UpdateLiabilityState,
  formData: FormData,
): Promise<UpdateLiabilityState> {
  await requireRole("superadmin");

  const parsed = parseLiabilityFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createClient();
  const payload = {
    name: parsed.name,
    liability_type: parsed.liabilityType,
    description: parsed.description,
    amount: parsed.amount,
    currency: parsed.currency,
    incurred_at: parsed.incurredAt,
    due_date: parsed.dueDate,
    settled_at: parsed.settledAt,
    notes: parsed.notes,
  } as never;

  const { error } = await supabase
    .from("liabilities")
    .update(payload)
    .eq("id", liabilityId);

  if (error) return { error: translateLiabilityError(error) };

  revalidatePath("/financiero/pasivos");
  revalidatePath("/financiero");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// setLiabilityActive — dar de baja / reactivar
// ═══════════════════════════════════════════════════════════════════════════
//
// "Inactivo" en pasivos es distinto de "saldado": inactivo = "ya no lleva
// libros" (cancelación por olvido, dato errado); saldado = "se pagó / se
// canceló legítimamente" (settled_at con fecha). Un pasivo activo pero
// saldado deja de restar del patrimonio pero queda visible como histórico.

export async function setLiabilityActive(
  liabilityId: string,
  active: boolean,
): Promise<ToggleLiabilityActiveResult> {
  await requireRole("superadmin");

  const supabase = await createClient();
  const payload = { active } as never;

  const { error } = await supabase
    .from("liabilities")
    .update(payload)
    .eq("id", liabilityId);

  if (error) return { error: translateLiabilityError(error) };

  revalidatePath("/financiero/pasivos");
  revalidatePath("/financiero");
  return { ok: true };
}
