"use server";

import { revalidatePath } from "next/cache";

import { resolveCurrentOrganizationId } from "@/lib/organization/current";
import { requireRole } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

import { translateBankError } from "./translate-error";

// ═══════════════════════════════════════════════════════════════════════════
// Server actions para banks — post 0101, org-scope.
//
// El shape del payload es intencionalmente chico:
//   - name (obligatorio, único por org)
//   - opening_balance (numero >= 0, default 0)
//   - active (default true al crear; el toggle va por setBankActive)
//
// NO exponemos `project_id` en el form. Sigue nullable en el schema (0101)
// por si mañana aparece un caso escrow, pero el flujo estándar no lo llena.
// ═══════════════════════════════════════════════════════════════════════════

export type CreateBankState =
  | { ok: true; bankId: string }
  | { error: string }
  | null;

export type UpdateBankState = { ok: true } | { error: string } | null;

export type ToggleBankActiveResult = { ok: true } | { error: string };

interface BankPayload {
  readonly name: string;
  readonly openingBalance: number;
}

function parseBankFormData(formData: FormData): BankPayload | string {
  const name = String(formData.get("name") ?? "").trim();
  if (name.length === 0) return "El nombre del banco es obligatorio.";

  const openingRaw = formData.get("opening_balance");
  const openingBalance =
    openingRaw == null || openingRaw === ""
      ? 0
      : Number(openingRaw);
  if (!Number.isFinite(openingBalance) || openingBalance < 0) {
    return "El saldo inicial tiene que ser un número positivo o 0.";
  }

  return { name, openingBalance };
}

// ═══════════════════════════════════════════════════════════════════════════
// createBank
// ═══════════════════════════════════════════════════════════════════════════

export async function createBank(
  _prev: CreateBankState,
  formData: FormData,
): Promise<CreateBankState> {
  await requireRole("superadmin");

  const parsed = parseBankFormData(formData);
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
    project_id: null,
    name: parsed.name,
    opening_balance: parsed.openingBalance,
    active: true,
  } as never;

  const { data, error } = await supabase
    .from("banks")
    .insert(payload)
    .select("id")
    .single();

  if (error) return { error: translateBankError(error) };
  const created = data as { id: string } | null;
  if (!created) return { error: "El insert no devolvió fila." };

  revalidatePath("/financiero/bancos");
  revalidatePath("/financiero/movimientos");
  revalidatePath("/financiero");
  return { ok: true, bankId: created.id };
}

// ═══════════════════════════════════════════════════════════════════════════
// updateBank — mantiene `active` intacto (toggle va por setBankActive)
// ═══════════════════════════════════════════════════════════════════════════

export async function updateBank(
  bankId: string,
  _prev: UpdateBankState,
  formData: FormData,
): Promise<UpdateBankState> {
  await requireRole("superadmin");

  const parsed = parseBankFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createClient();
  const payload = {
    name: parsed.name,
    opening_balance: parsed.openingBalance,
  } as never;

  const { error } = await supabase
    .from("banks")
    .update(payload)
    .eq("id", bankId);

  if (error) return { error: translateBankError(error) };

  revalidatePath("/financiero/bancos");
  revalidatePath("/financiero/movimientos");
  revalidatePath("/financiero");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// setBankActive — dar de baja / reactivar (sin delete)
// ═══════════════════════════════════════════════════════════════════════════
//
// Un banco dado de baja deja de ser opción para nuevos payment_methods y
// nuevos bank_movements, pero los históricos siguen visibles y su saldo se
// sigue calculando. Es como la desactivación de asset. NO borrar — sino
// perdemos trazabilidad de cobros históricos.

export async function setBankActive(
  bankId: string,
  active: boolean,
): Promise<ToggleBankActiveResult> {
  await requireRole("superadmin");

  const supabase = await createClient();
  const payload = { active } as never;

  const { error } = await supabase
    .from("banks")
    .update(payload)
    .eq("id", bankId);

  if (error) return { error: translateBankError(error) };

  revalidatePath("/financiero/bancos");
  revalidatePath("/financiero/movimientos");
  revalidatePath("/financiero");
  return { ok: true };
}
