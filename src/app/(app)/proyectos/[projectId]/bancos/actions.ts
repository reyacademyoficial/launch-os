"use server";

import { revalidatePath } from "next/cache";

import type { BankMovementKind } from "@/lib/banks/types";
import { requireCanEditProject } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export type BankActionState = { ok: true } | { error: string } | null;
export type BankMovementActionState =
  | { ok: true }
  | { error: string }
  | null;

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function parseMoney(value: string): number | null {
  if (value === "") return null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

// ─── Bancos ─────────────────────────────────────────────────────────────────

export async function createBank(
  projectId: string,
  _prev: BankActionState,
  formData: FormData,
): Promise<BankActionState> {
  await requireCanEditProject(projectId);

  const name = str(formData, "name");
  if (!name) return { error: "El nombre es obligatorio." };

  const openingRaw = str(formData, "opening_balance");
  const opening = openingRaw === "" ? 0 : parseMoney(openingRaw);
  if (opening === null || opening < 0) {
    return { error: "Saldo inicial inválido (debe ser 0 o positivo)." };
  }

  const supabase = await createClient();
  const payload = {
    project_id: projectId,
    name,
    opening_balance: opening,
    active: true,
  } as never;
  const { error } = await supabase.from("banks").insert(payload);
  if (error) {
    if (error.code === "23505") {
      return { error: "Ya existe un banco con ese nombre en el proyecto." };
    }
    return { error: error.message };
  }

  revalidateForProject(projectId);
  return { ok: true };
}

export async function updateBank(
  projectId: string,
  bankId: string,
  _prev: BankActionState,
  formData: FormData,
): Promise<BankActionState> {
  await requireCanEditProject(projectId);

  const name = str(formData, "name");
  if (!name) return { error: "El nombre es obligatorio." };
  const active = formData.get("active") !== null;

  const openingRaw = str(formData, "opening_balance");
  const opening = openingRaw === "" ? 0 : parseMoney(openingRaw);
  if (opening === null || opening < 0) {
    return { error: "Saldo inicial inválido (debe ser 0 o positivo)." };
  }

  const supabase = await createClient();
  const payload = { name, active, opening_balance: opening } as never;
  const { error } = await supabase
    .from("banks")
    .update(payload)
    .eq("id", bankId)
    .eq("project_id", projectId);
  if (error) {
    if (error.code === "23505") {
      return { error: "Ya existe otro banco con ese nombre." };
    }
    return { error: error.message };
  }

  revalidateForProject(projectId);
  return { ok: true };
}

/**
 * Borra el banco. `bank_movements` van en cascada (on delete cascade). Los
 * `payment_methods.bank_id` que apuntan acá se ponen en NULL (on delete
 * set null) — el método sigue existiendo pero pierde routing y sus cobros
 * dejan de sumar a ningún banco.
 */
export async function deleteBank(
  projectId: string,
  bankId: string,
): Promise<{ ok: true } | { error: string }> {
  await requireCanEditProject(projectId);
  const supabase = await createClient();
  const { error } = await supabase
    .from("banks")
    .delete()
    .eq("id", bankId)
    .eq("project_id", projectId);
  if (error) return { error: error.message };

  revalidateForProject(projectId);
  return { ok: true };
}

// ─── Movimientos ────────────────────────────────────────────────────────────

/**
 * Los movimientos son ingresos/egresos manuales — cosas que no son cobros de
 * ventas (cobros se agregan automáticamente por payment_method → bank). Se
 * verifica que el bank pertenezca al proyecto antes de insertar; RLS también
 * lo hace, pero adelantarlo devuelve mejor error UX.
 */
export async function createBankMovement(
  projectId: string,
  bankId: string,
  _prev: BankMovementActionState,
  formData: FormData,
): Promise<BankMovementActionState> {
  await requireCanEditProject(projectId);

  const parsed = parseMovementInput(formData);
  if ("error" in parsed) return parsed;

  const supabase = await createClient();

  // Sanity check: bank existe y es del proyecto.
  const { data: bankData } = await supabase
    .from("banks")
    .select("id")
    .eq("id", bankId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!bankData) return { error: "Banco inexistente o de otro proyecto." };

  const { data: userData } = await supabase.auth.getUser();

  const payload = {
    bank_id: bankId,
    kind: parsed.kind,
    amount: parsed.amount,
    occurred_at: parsed.occurredAt,
    description: parsed.description,
    created_by: userData.user?.id ?? null,
  } as never;

  const { error } = await supabase.from("bank_movements").insert(payload);
  if (error) return { error: error.message };

  revalidateForProject(projectId);
  return { ok: true };
}

export async function updateBankMovement(
  projectId: string,
  movementId: string,
  _prev: BankMovementActionState,
  formData: FormData,
): Promise<BankMovementActionState> {
  await requireCanEditProject(projectId);

  const parsed = parseMovementInput(formData);
  if ("error" in parsed) return parsed;

  const supabase = await createClient();
  const payload = {
    kind: parsed.kind,
    amount: parsed.amount,
    occurred_at: parsed.occurredAt,
    description: parsed.description,
  } as never;

  // No forzamos bank_id nuevo: el movimiento queda en su banco original. Para
  // moverlo a otro banco, borrás y volvés a cargar.
  const { error } = await supabase
    .from("bank_movements")
    .update(payload)
    .eq("id", movementId);
  if (error) return { error: error.message };

  revalidateForProject(projectId);
  return { ok: true };
}

export async function deleteBankMovement(
  projectId: string,
  movementId: string,
): Promise<{ ok: true } | { error: string }> {
  await requireCanEditProject(projectId);
  const supabase = await createClient();
  const { error } = await supabase
    .from("bank_movements")
    .delete()
    .eq("id", movementId);
  if (error) return { error: error.message };

  revalidateForProject(projectId);
  return { ok: true };
}

function parseMovementInput(formData: FormData):
  | {
      kind: BankMovementKind;
      amount: number;
      occurredAt: string;
      description: string | null;
    }
  | { error: string } {
  const kindRaw = str(formData, "kind");
  if (kindRaw !== "in" && kindRaw !== "out") {
    return { error: "Tipo de movimiento inválido (usá entrada o salida)." };
  }
  const kind = kindRaw as BankMovementKind;

  const amountRaw = str(formData, "amount");
  const amount = parseMoney(amountRaw);
  if (amount === null || amount <= 0) {
    return { error: "Monto debe ser mayor a 0." };
  }

  const occurredAt = str(formData, "occurred_at");
  if (!occurredAt) return { error: "Fecha es obligatoria." };

  const description = str(formData, "description");
  return {
    kind,
    amount,
    occurredAt,
    description: description === "" ? null : description,
  };
}

function revalidateForProject(projectId: string): void {
  revalidatePath(`/proyectos/${projectId}/bancos`);
  revalidatePath(`/proyectos/${projectId}/metodos-pago`);
}
