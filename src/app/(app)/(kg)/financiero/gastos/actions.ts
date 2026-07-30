"use server";

import { revalidatePath } from "next/cache";

import { isValidExpenseCategory } from "@/lib/finance/expense-categories";
import { resolveCurrentOrganizationId } from "@/lib/organization/current";
import { requireRole } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

import { translateExpenseError } from "./translate-error";

// ═══════════════════════════════════════════════════════════════════════════
// Contratos de retorno — mismo patrón discriminated que rotateRule/personas
// ═══════════════════════════════════════════════════════════════════════════

export type CreateExpenseState =
  | { ok: true; expenseId: string }
  | { error: string }
  | null;

export type UpdateExpenseState = { ok: true } | { error: string } | null;

export type LinkPaymentResult =
  | { ok: true }
  | { error: string };

// ═══════════════════════════════════════════════════════════════════════════
// Payload compartido create/update — mismos campos, dos actions distintas
// ═══════════════════════════════════════════════════════════════════════════

interface ExpensePayload {
  readonly description: string;
  readonly category: string | null;
  readonly amountGross: number;
  readonly taxAmount: number;
  readonly currency: string;
  readonly expenseDate: string;
  readonly dueDate: string | null;
  readonly notes: string | null;
}

function parseExpenseFormData(formData: FormData): ExpensePayload | string {
  const description = String(formData.get("description") ?? "").trim();
  if (description.length === 0) return "La descripción es obligatoria.";

  const categoryRaw = String(formData.get("category") ?? "").trim();
  // Category es opcional a nivel DB, pero el form la fuerza. Si viene una
  // no-listada (client tampering), la aceptamos como null en vez de mentirle
  // al humano — la fila queda visible como "Sin categoría" en el gráfico.
  const category = isValidExpenseCategory(categoryRaw) ? categoryRaw : null;

  const amountGross = Number(formData.get("amount_gross"));
  if (!Number.isFinite(amountGross) || amountGross < 0) {
    return "El monto bruto tiene que ser un número positivo.";
  }

  const taxAmountRaw = formData.get("tax_amount");
  const taxAmount =
    taxAmountRaw == null || taxAmountRaw === "" ? 0 : Number(taxAmountRaw);
  if (!Number.isFinite(taxAmount) || taxAmount < 0) {
    return "El IVA tiene que ser un número positivo (o 0).";
  }
  // Validación cliente-side espejando el CHECK 0063 línea 75. Sin esto, el
  // usuario cae en el 23514 del server con mensaje menos claro.
  if (taxAmount > amountGross) {
    return "El IVA no puede superar el monto bruto del gasto.";
  }

  const currencyRaw = String(formData.get("currency") ?? "ARS").trim().toUpperCase();
  const currency = currencyRaw.length > 0 ? currencyRaw : "ARS";

  const expenseDate = String(formData.get("expense_date") ?? "").trim();
  if (!isYmd(expenseDate)) {
    return "Elegí una fecha de gasto válida.";
  }

  const dueDateRaw = String(formData.get("due_date") ?? "").trim();
  const dueDate = dueDateRaw.length === 0 ? null : dueDateRaw;
  if (dueDate != null && !isYmd(dueDate)) {
    return "La fecha de vencimiento no es válida.";
  }

  const notesRaw = String(formData.get("notes") ?? "").trim();
  const notes = notesRaw.length === 0 ? null : notesRaw;

  return {
    description,
    category,
    amountGross,
    taxAmount,
    currency,
    expenseDate,
    dueDate,
    notes,
  };
}

function isYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// ═══════════════════════════════════════════════════════════════════════════
// createExpense
// ═══════════════════════════════════════════════════════════════════════════

export async function createExpense(
  _prev: CreateExpenseState,
  formData: FormData,
): Promise<CreateExpenseState> {
  await requireRole("superadmin");

  const parsed = parseExpenseFormData(formData);
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
    description: parsed.description,
    category: parsed.category,
    // Todos los satélites en null a propósito — decisión 6c-write.B:
    // supplier/account/cost_center/tax se exponen cuando duela.
    supplier_id: null,
    account_id: null,
    cost_center_id: null,
    tax_id: null,
    amount_gross: parsed.amountGross,
    tax_amount: parsed.taxAmount,
    currency: parsed.currency,
    expense_date: parsed.expenseDate,
    due_date: parsed.dueDate,
    // paid_at y bank_movement_id quedan null. Se setean por linkExpenseToPayment.
    paid_at: null,
    bank_movement_id: null,
    notes: parsed.notes,
  } as never;

  const { data, error } = await supabase
    .from("expenses")
    .insert(payload)
    .select("id")
    .single();

  if (error) return { error: translateExpenseError(error) };

  const created = data as { id: string } | null;
  if (!created) return { error: "El insert no devolvió fila." };

  revalidatePath("/financiero/gastos");
  revalidatePath("/financiero");
  return { ok: true, expenseId: created.id };
}

// ═══════════════════════════════════════════════════════════════════════════
// updateExpense — no toca paid_at ni bank_movement_id
// ═══════════════════════════════════════════════════════════════════════════

export async function updateExpense(
  expenseId: string,
  _prev: UpdateExpenseState,
  formData: FormData,
): Promise<UpdateExpenseState> {
  await requireRole("superadmin");

  const parsed = parseExpenseFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createClient();
  const payload = {
    description: parsed.description,
    category: parsed.category,
    amount_gross: parsed.amountGross,
    tax_amount: parsed.taxAmount,
    currency: parsed.currency,
    expense_date: parsed.expenseDate,
    due_date: parsed.dueDate,
    notes: parsed.notes,
    // NO tocamos paid_at ni bank_movement_id. Ese flujo va por
    // linkExpenseToPayment / unlinkExpensePayment.
  } as never;

  const { error } = await supabase
    .from("expenses")
    .update(payload)
    .eq("id", expenseId);

  if (error) return { error: translateExpenseError(error) };

  revalidatePath("/financiero/gastos");
  revalidatePath("/financiero");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// linkExpenseToPayment — vincula un expense a un bank_movement existente
// ═══════════════════════════════════════════════════════════════════════════
//
// La operación conceptual clave del bloque. NO crea el bank_movement — usa
// uno ya existente (feedback 6c-write.A: si crea, produce el duplicado que
// este flujo viene a evitar).
//
// El bank_movement puede tener OTROS expenses ya linkeados (por ej. una
// transferencia que pagó dos SaaS). No forzamos 1-a-1 — el schema tampoco.
// Al vincular:
//   - paid_at ← bank_movement.occurred_at
//   - bank_movement_id ← input
//   - status implícito → 'pagado' (derivable de paid_at)

export async function linkExpenseToPayment(
  expenseId: string,
  bankMovementId: string,
): Promise<LinkPaymentResult> {
  await requireRole("superadmin");

  const supabase = await createClient();

  // Leer occurred_at del bank_movement para setear paid_at coherentemente.
  // Sin esto, tendríamos que asumir "hoy" y perderíamos la fecha real del pago.
  const bmRes = await supabase
    .from("bank_movements")
    .select("id, occurred_at, kind")
    .eq("id", bankMovementId)
    .maybeSingle();

  if (bmRes.error) return { error: bmRes.error.message };
  const bm = bmRes.data as
    | { id: string; occurred_at: string; kind: "in" | "out" }
    | null;
  if (!bm) {
    return {
      error:
        "El movimiento bancario ya no existe. Recargá y volvé a intentar.",
    };
  }
  // Guard: un ingreso no puede pagar un gasto. La UI lo penaliza en el
  // scoring pero permite verlo — este guard es la defensa final.
  if (bm.kind === "in") {
    return {
      error:
        "El movimiento elegido es una ENTRADA. Solo las salidas pueden pagar un gasto.",
    };
  }

  const payload = {
    paid_at: bm.occurred_at,
    bank_movement_id: bm.id,
  } as never;

  const { error } = await supabase
    .from("expenses")
    .update(payload)
    .eq("id", expenseId);

  if (error) return { error: translateExpenseError(error) };

  revalidatePath("/financiero/gastos");
  revalidatePath("/financiero/movimientos");
  revalidatePath("/financiero");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// unlinkExpensePayment — deshace la vinculación (sin borrar el expense)
// ═══════════════════════════════════════════════════════════════════════════
//
// Único camino de corrección para una conciliación equivocada — el bloque
// no expone borrado. Marca el gasto como impago (paid_at=null) y suelta el
// link al movimiento (bank_movement_id=null). El bank_movement queda intacto
// — puede vincularse a otro expense.

export async function unlinkExpensePayment(
  expenseId: string,
): Promise<LinkPaymentResult> {
  await requireRole("superadmin");

  const supabase = await createClient();
  const payload = {
    paid_at: null,
    bank_movement_id: null,
  } as never;

  const { error } = await supabase
    .from("expenses")
    .update(payload)
    .eq("id", expenseId);

  if (error) return { error: translateExpenseError(error) };

  revalidatePath("/financiero/gastos");
  revalidatePath("/financiero/movimientos");
  revalidatePath("/financiero");
  return { ok: true };
}
