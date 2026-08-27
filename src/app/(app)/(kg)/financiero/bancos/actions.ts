"use server";

import { revalidatePath, updateTag } from "next/cache";

import { currentOrgTagsFinance } from "@/lib/finance/reference";
import { resolveCurrentOrganizationId } from "@/lib/organization/current";
import { requireRole } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

import { translateBankError } from "./translate-error";

async function bustBanksCache(): Promise<void> {
  const tags = await currentOrgTagsFinance();
  if (tags) updateTag(tags.banks);
}

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
  readonly currency: "ARS" | "USD";
  readonly isExternalCollector: boolean;
  readonly externalProjectId: string | null;
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

  const currency = String(formData.get("currency") ?? "").trim();
  if (currency !== "ARS" && currency !== "USD") {
    return "La moneda del banco tiene que ser ARS o USD.";
  }

  // Cobro externo: checkbox → boolean; el proyecto solo tiene sentido si el
  // checkbox está tildado. Si el checkbox NO está tildado, forzamos null aunque
  // el form mande algo (bicondicional enforced por CHECK banks_external_collector_coherence).
  const isExternalCollector =
    formData.get("is_external_collector") === "on";
  const externalProjectRaw = String(
    formData.get("external_project_id") ?? "",
  ).trim();
  const externalProjectId = isExternalCollector
    ? externalProjectRaw.length > 0
      ? externalProjectRaw
      : null
    : null;
  if (isExternalCollector && externalProjectId == null) {
    return "Al marcar 'cobro externo', tenés que elegir a qué proyecto pertenece.";
  }

  return {
    name,
    openingBalance,
    currency,
    isExternalCollector,
    externalProjectId,
  };
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
    currency: parsed.currency,
    active: true,
    is_external_collector: parsed.isExternalCollector,
    external_project_id: parsed.externalProjectId,
  } as never;

  const { data, error } = await supabase
    .from("banks")
    .insert(payload)
    .select("id")
    .single();

  if (error) return { error: translateBankError(error) };
  const created = data as { id: string } | null;
  if (!created) return { error: "El insert no devolvió fila." };

  await bustBanksCache();
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
    currency: parsed.currency,
    is_external_collector: parsed.isExternalCollector,
    external_project_id: parsed.externalProjectId,
  } as never;

  const { error } = await supabase
    .from("banks")
    .update(payload)
    .eq("id", bankId);

  if (error) return { error: translateBankError(error) };

  await bustBanksCache();
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

  await bustBanksCache();
  revalidatePath("/financiero/bancos");
  revalidatePath("/financiero/movimientos");
  revalidatePath("/financiero");
  return { ok: true };
}
