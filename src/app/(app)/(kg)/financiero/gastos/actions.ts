"use server";

import { revalidatePath } from "next/cache";

import { isValidExpenseCategory } from "@/lib/finance/expense-categories";
import {
  parseExpensesWorkbook,
  type ParseError,
} from "@/lib/finance/xlsx-import";
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

export type DeleteExpenseResult = { ok: true } | { error: string };

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
  readonly transactionNumber: string | null;
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

  const txRaw = String(formData.get("transaction_number") ?? "").trim();
  const transactionNumber = txRaw.length === 0 ? null : txRaw;

  return {
    description,
    category,
    amountGross,
    taxAmount,
    currency,
    expenseDate,
    dueDate,
    notes,
    transactionNumber,
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
    transaction_number: parsed.transactionNumber,
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
    transaction_number: parsed.transactionNumber,
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

// ═══════════════════════════════════════════════════════════════════════════
// deleteExpense — bloquea si el gasto está vinculado a un pago
// ═══════════════════════════════════════════════════════════════════════════
//
// Mismo criterio que deleteBankMovement: si hay link (paid_at + bank_movement_id),
// el operador tiene que desvincular primero desde "Ver pago". Sin este guard,
// un borrado silencioso deja el bank_movement huérfano sin traza del gasto
// que lo justificaba — imposible de auditar después.

export async function deleteExpense(
  expenseId: string,
): Promise<DeleteExpenseResult> {
  await requireRole("superadmin");

  if (!expenseId) return { error: "Falta el id del gasto." };

  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("expenses")
    .select("id, paid_at, bank_movement_id")
    .eq("id", expenseId)
    .maybeSingle();
  if (!existing) {
    return { error: "El gasto ya no existe o no tenés acceso." };
  }

  const row = existing as {
    id: string;
    paid_at: string | null;
    bank_movement_id: string | null;
  };
  if (row.paid_at != null || row.bank_movement_id != null) {
    return {
      error:
        "No se puede eliminar: el gasto está vinculado a un movimiento bancario. " +
        'Desvinculá primero desde "Ver pago" y volvé a intentar.',
    };
  }

  const { error } = await supabase
    .from("expenses")
    .delete()
    .eq("id", expenseId);

  if (error) return { error: translateExpenseError(error) };

  revalidatePath("/financiero/gastos");
  revalidatePath("/financiero");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// Import xlsx — preview + confirm
// ═══════════════════════════════════════════════════════════════════════════
//
// Los gastos se importan sin paid_at ni bank_movement_id — la conciliación
// va por linkExpenseToPayment desde la UI. Motivo: importar la vinculación
// requiere matchear el bank_movement por (banco+fecha+monto), un algoritmo
// aparte que no vale la complejidad hasta que se demuestre demanda.

const IMPORT_BATCH_SIZE = 200;

export interface ImportPreviewOk {
  readonly ok: true;
  readonly validCount: number;
  readonly errorCount: number;
  readonly totalRows: number;
  readonly errors: ReadonlyArray<ParseError>;
}
export type ImportPreviewResult =
  | ImportPreviewOk
  | { ok: false; error: string };

export interface ImportConfirmOk {
  readonly ok: true;
  readonly imported: number;
  readonly errors: ReadonlyArray<ParseError>;
}
export type ImportConfirmResult =
  | ImportConfirmOk
  | { ok: false; error: string };

async function readXlsxFile(
  formData: FormData,
): Promise<{ ok: true; buffer: Buffer } | { ok: false; error: string }> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Seleccioná un archivo .xlsx" };
  }
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    return { ok: false, error: "El archivo tiene que ser .xlsx" };
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  return { ok: true, buffer };
}

export async function previewExpensesImport(
  _prev: ImportPreviewResult | null,
  formData: FormData,
): Promise<ImportPreviewResult> {
  await requireRole("superadmin");

  const fileRes = await readXlsxFile(formData);
  if (!fileRes.ok) return { ok: false, error: fileRes.error };

  try {
    const parsed = await parseExpensesWorkbook(fileRes.buffer);
    if (parsed.headerError) {
      return { ok: false, error: parsed.headerError };
    }
    return {
      ok: true,
      validCount: parsed.rows.length,
      errorCount: parsed.errors.length,
      totalRows: parsed.totalRows,
      errors: parsed.errors,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error parseando el xlsx",
    };
  }
}

export async function confirmExpensesImport(
  _prev: ImportConfirmResult | null,
  formData: FormData,
): Promise<ImportConfirmResult> {
  await requireRole("superadmin");

  const fileRes = await readXlsxFile(formData);
  if (!fileRes.ok) return { ok: false, error: fileRes.error };

  let organizationId: string | null;
  try {
    organizationId = await resolveCurrentOrganizationId();
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error ? e.message : "Error resolviendo la organización.",
    };
  }
  if (!organizationId) {
    return {
      ok: false,
      error: "No pudimos resolver tu organización. Revisá tus permisos.",
    };
  }

  try {
    const supabase = await createClient();
    const parsed = await parseExpensesWorkbook(fileRes.buffer);
    if (parsed.headerError) {
      return { ok: false, error: parsed.headerError };
    }

    if (parsed.rows.length === 0) {
      return {
        ok: true,
        imported: 0,
        errors: parsed.errors,
      };
    }

    const insertErrors: ParseError[] = [];
    let imported = 0;

    for (let i = 0; i < parsed.rows.length; i += IMPORT_BATCH_SIZE) {
      const slice = parsed.rows.slice(i, i + IMPORT_BATCH_SIZE);
      const payload = slice.map((r) => ({
        organization_id: organizationId,
        description: r.description,
        category: r.category,
        supplier_id: null,
        account_id: null,
        cost_center_id: null,
        tax_id: null,
        amount_gross: r.amount_gross,
        tax_amount: r.tax_amount,
        currency: r.currency,
        expense_date: r.expense_date,
        due_date: r.due_date,
        paid_at: null,
        bank_movement_id: null,
        notes: r.notes,
      })) as never;

      const { data, error } = await supabase
        .from("expenses")
        .insert(payload)
        .select("id");

      if (error) {
        insertErrors.push({
          rowNumber: i + 2,
          reason: `Batch: ${translateExpenseError(error)}`,
        });
        continue;
      }
      imported += data?.length ?? 0;
    }

    revalidatePath("/financiero/gastos");
    revalidatePath("/financiero");

    return {
      ok: true,
      imported,
      errors: [...parsed.errors, ...insertErrors],
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error procesando el xlsx",
    };
  }
}
