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

export type ExpenseMovementRole = "principal" | "comision" | "otro";

export type DeleteExpenseResult = { ok: true } | { error: string };

export type BulkDeleteExpensesResult =
  | { ok: true; deleted: number }
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
  readonly transactionNumber: string | null;
  /** null = gasto org-level (0131). uuid = atribución a proyecto. */
  readonly projectId: string | null;
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

  // project_id opcional. El picker manda "" para "sin proyecto" (org-level);
  // un uuid concreto para atribución. El trigger de 0131 valida coherencia
  // org-scope — acá solo pasamos el valor.
  const projectIdRaw = String(formData.get("project_id") ?? "").trim();
  const projectId = projectIdRaw.length === 0 ? null : projectIdRaw;

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
    projectId,
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
    project_id: parsed.projectId,
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
    project_id: parsed.projectId,
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
// linkExpenseToMovement — inserta fila en expense_bank_movements (paso 6)
// ═══════════════════════════════════════════════════════════════════════════
//
// Post 0119 el gasto puede tener N movimientos: principal (la salida en sí)
// + comision (fee bancario/pasarela) + otro (ajustes). El trigger
// recompute_expense_paid_at setea paid_at = MAX(occurred_at) de los
// principales linkeados.
//
// Guards:
//   - Misma organización (RLS también lo bloquearía).
//   - role='principal' requiere kind='out'.
//   - role='comision' u 'otro' aceptan cualquier kind.

export async function linkExpenseToMovement(
  expenseId: string,
  bankMovementId: string,
  role: ExpenseMovementRole = "principal",
): Promise<LinkPaymentResult> {
  await requireRole("superadmin");

  if (!expenseId || !bankMovementId) {
    return { error: "Falta expense_id o bank_movement_id." };
  }

  const supabase = await createClient();

  const [{ data: expRow }, { data: bmRow }] = await Promise.all([
    supabase
      .from("expenses")
      .select("id, organization_id")
      .eq("id", expenseId)
      .maybeSingle(),
    supabase
      .from("bank_movements")
      .select("id, kind, organization_id")
      .eq("id", bankMovementId)
      .maybeSingle(),
  ]);
  const exp = expRow as { id: string; organization_id: string } | null;
  const bm = bmRow as
    | { id: string; kind: "in" | "out"; organization_id: string }
    | null;
  if (!exp) return { error: "El gasto ya no existe o no tenés acceso." };
  if (!bm) return { error: "El movimiento ya no existe o no tenés acceso." };
  if (exp.organization_id !== bm.organization_id) {
    return { error: "Gasto y movimiento son de organizaciones distintas." };
  }
  if (role === "principal" && bm.kind !== "out") {
    return {
      error:
        "El movimiento 'principal' de un gasto tiene que ser una SALIDA. Elegí role='comision' u 'otro' para entradas (reembolsos).",
    };
  }

  const { error } = await supabase
    .from("expense_bank_movements")
    .insert({
      expense_id: expenseId,
      bank_movement_id: bankMovementId,
      role,
    } as never);

  if (error) {
    if (error.code === "23505") {
      return { error: "Ese movimiento ya está vinculado a este gasto." };
    }
    return { error: translateExpenseError(error) };
  }

  revalidatePath("/financiero/gastos");
  revalidatePath("/financiero/movimientos");
  revalidatePath("/financiero");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// unlinkExpenseFromMovement — borra fila del bridge; trigger recomputa paid_at
// ═══════════════════════════════════════════════════════════════════════════

export async function unlinkExpenseFromMovement(
  expenseId: string,
  bankMovementId: string,
): Promise<LinkPaymentResult> {
  await requireRole("superadmin");

  if (!expenseId || !bankMovementId) {
    return { error: "Falta expense_id o bank_movement_id." };
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from("expense_bank_movements")
    .delete()
    .eq("expense_id", expenseId)
    .eq("bank_movement_id", bankMovementId);

  if (error) return { error: translateExpenseError(error) };

  revalidatePath("/financiero/gastos");
  revalidatePath("/financiero/movimientos");
  revalidatePath("/financiero");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// Compat shims — mantienen la firma vieja mientras la UI del drawer migra.
// ═══════════════════════════════════════════════════════════════════════════
//
// La UI actual (link-payment-drawer.tsx) es 1:1 (un gasto, un movimiento).
// Se reescribe en el paso 6 para usar link/unlink del bridge. Estos wrappers
// delegan al nuevo modelo para no romper nada en la transición.

export async function linkExpenseToPayment(
  expenseId: string,
  bankMovementId: string,
): Promise<LinkPaymentResult> {
  return linkExpenseToMovement(expenseId, bankMovementId, "principal");
}

export async function unlinkExpensePayment(
  expenseId: string,
): Promise<LinkPaymentResult> {
  await requireRole("superadmin");
  const supabase = await createClient();

  // Compat: la firma vieja no toma movementId. Borramos todas las filas del
  // bridge para el gasto (típicamente sólo una, pre-migración). Trigger
  // limpia paid_at al quedar el bridge vacío.
  const { error } = await supabase
    .from("expense_bank_movements")
    .delete()
    .eq("expense_id", expenseId);

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

  // Post 0119: el guard también mira el bridge — un gasto con sólo comisión
  // linkeada (sin principal) puede tener paid_at=null pero seguir vinculado.
  const { count: bridgeCount } = await supabase
    .from("expense_bank_movements")
    .select("expense_id", { count: "exact", head: true })
    .eq("expense_id", expenseId);

  if (
    row.paid_at != null ||
    row.bank_movement_id != null ||
    (bridgeCount ?? 0) > 0
  ) {
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
// bulkDeleteExpenses — borrado masivo con quiebre previo de vínculos
// ═══════════════════════════════════════════════════════════════════════════
//
// A diferencia de deleteExpense (bloquea si hay pago vinculado), este action
// asume nuclearización. Caso de uso: re-importar gastos desde cero. Vacía
// primero el bridge expense_bank_movements para todos los ids — el trigger
// recompute_expense_paid_at deja el gasto con paid_at=null — y después
// borra los gastos.
//
// Los bank_movements NO se tocan: siguen existiendo como movimientos sin
// conciliar en la tabla de movimientos, que es lo que se espera si el
// operador está limpiando gastos para volver a cargarlos.

const BULK_DELETE_BATCH_SIZE = 500;

export async function bulkDeleteExpenses(
  expenseIds: readonly string[],
): Promise<BulkDeleteExpensesResult> {
  await requireRole("superadmin");

  const ids = Array.from(new Set(expenseIds.filter((id) => id.length > 0)));
  if (ids.length === 0) return { error: "No hay gastos seleccionados." };

  const supabase = await createClient();

  let deleted = 0;
  for (let i = 0; i < ids.length; i += BULK_DELETE_BATCH_SIZE) {
    const slice = ids.slice(i, i + BULK_DELETE_BATCH_SIZE);

    // 1. Vaciar bridge — dispara recompute_expense_paid_at
    const bridgeRes = await supabase
      .from("expense_bank_movements")
      .delete()
      .in("expense_id", slice);
    if (bridgeRes.error) {
      return { error: translateExpenseError(bridgeRes.error) };
    }

    // 2. Borrar los gastos
    const { data, error } = await supabase
      .from("expenses")
      .delete()
      .in("id", slice)
      .select("id");
    if (error) return { error: translateExpenseError(error) };
    deleted += (data as { id: string }[] | null)?.length ?? 0;
  }

  revalidatePath("/financiero/gastos");
  revalidatePath("/financiero/movimientos");
  revalidatePath("/financiero");
  return { ok: true, deleted };
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
        transaction_number: r.transaction_number,
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
