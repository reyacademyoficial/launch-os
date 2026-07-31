"use server";

import { revalidatePath } from "next/cache";

import type { BankMovementKind } from "@/lib/banks/types";
import { resolveCurrentOrganizationId } from "@/lib/organization/current";
import { requireRole } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

import { translateBankMovementError } from "./translate-error";

// ═══════════════════════════════════════════════════════════════════════════
// Server actions para bank_movements desde Kingrow — post 0101, org-scope.
//
// Sin delete. Un movimiento borrado dejaría `expenses.bank_movement_id` en
// NULL (FK SET NULL) pero el `expenses.paid_at` seguiría seteado — el gasto
// queda "pagado sin movimiento", estado inconsistente que el drawer de
// linkPayment no puede corregir (no ofrece re-vincular un gasto ya pagado).
// La política es: si te equivocaste, editás; si el movimiento no debería
// existir, editá la fecha/monto a lo correcto o dejá una nota. Coherente
// con la política del bloque de gastos.
//
// bank_id NO se puede cambiar en update. Igual que con `updatePaymentMethod`
// respecto a project_id — cambiarlo rompería la coherencia con lo que ya
// está agregado en el saldo del banco original. Para moverlo, se hace uno
// nuevo en el otro banco.
// ═══════════════════════════════════════════════════════════════════════════

export type CreateBankMovementState =
  | { ok: true; movementId: string }
  | { error: string }
  | null;

export type UpdateBankMovementState =
  | { ok: true }
  | { error: string }
  | null;

interface BankMovementPayload {
  readonly bankId: string;
  readonly kind: BankMovementKind;
  readonly amount: number;
  readonly occurredAt: string;
  readonly description: string | null;
}

function parseFormData(
  formData: FormData,
  requireBankId: boolean,
): BankMovementPayload | string {
  const bankId = String(formData.get("bank_id") ?? "").trim();
  if (requireBankId && bankId.length === 0) return "Elegí un banco.";

  const kindRaw = String(formData.get("kind") ?? "").trim();
  if (kindRaw !== "in" && kindRaw !== "out") {
    return "El tipo del movimiento debe ser entrada o salida.";
  }
  const kind = kindRaw as BankMovementKind;

  const amount = Number(formData.get("amount"));
  if (!Number.isFinite(amount) || amount <= 0) {
    return "El monto tiene que ser mayor a 0.";
  }

  const occurredAt = String(formData.get("occurred_at") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredAt)) {
    return "Elegí una fecha válida.";
  }

  const descriptionRaw = String(formData.get("description") ?? "").trim();
  const description = descriptionRaw.length === 0 ? null : descriptionRaw;

  return { bankId, kind, amount, occurredAt, description };
}

// ═══════════════════════════════════════════════════════════════════════════
// createBankMovement
// ═══════════════════════════════════════════════════════════════════════════

export async function createBankMovement(
  _prev: CreateBankMovementState,
  formData: FormData,
): Promise<CreateBankMovementState> {
  await requireRole("superadmin");

  const parsed = parseFormData(formData, true);
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

  // Sanity check: bank existe y es de la misma org que el usuario. Sin
  // esto RLS igual bloquearía, pero el mensaje sería el genérico de RLS.
  const { data: bank } = await supabase
    .from("banks")
    .select("id, organization_id")
    .eq("id", parsed.bankId)
    .maybeSingle();
  if (!bank) return { error: "El banco elegido no existe." };
  const bankOrg = (bank as { organization_id: string }).organization_id;
  if (bankOrg !== organizationId) {
    return { error: "El banco elegido no pertenece a tu organización." };
  }

  const { data: userData } = await supabase.auth.getUser();

  const payload = {
    bank_id: parsed.bankId,
    organization_id: organizationId,
    kind: parsed.kind,
    amount: parsed.amount,
    occurred_at: parsed.occurredAt,
    description: parsed.description,
    created_by: userData.user?.id ?? null,
  } as never;

  const { data, error } = await supabase
    .from("bank_movements")
    .insert(payload)
    .select("id")
    .single();

  if (error) return { error: translateBankMovementError(error) };
  const created = data as { id: string } | null;
  if (!created) return { error: "El insert no devolvió fila." };

  revalidatePath("/financiero/movimientos");
  revalidatePath("/financiero/bancos");
  revalidatePath("/financiero/gastos");
  revalidatePath("/financiero");
  return { ok: true, movementId: created.id };
}

// ═══════════════════════════════════════════════════════════════════════════
// updateBankMovement — bank_id NO se puede cambiar
// ═══════════════════════════════════════════════════════════════════════════

export async function updateBankMovement(
  movementId: string,
  _prev: UpdateBankMovementState,
  formData: FormData,
): Promise<UpdateBankMovementState> {
  await requireRole("superadmin");

  const parsed = parseFormData(formData, false);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createClient();
  const payload = {
    // bank_id NO se toca — ver comentario cabecera del módulo.
    kind: parsed.kind,
    amount: parsed.amount,
    occurred_at: parsed.occurredAt,
    description: parsed.description,
  } as never;

  const { error } = await supabase
    .from("bank_movements")
    .update(payload)
    .eq("id", movementId);

  if (error) return { error: translateBankMovementError(error) };

  revalidatePath("/financiero/movimientos");
  revalidatePath("/financiero/bancos");
  revalidatePath("/financiero/gastos");
  revalidatePath("/financiero");
  return { ok: true };
}
