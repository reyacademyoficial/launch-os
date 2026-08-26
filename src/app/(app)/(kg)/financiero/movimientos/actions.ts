"use server";

import { revalidatePath } from "next/cache";

import type { BankMovementKind } from "@/lib/banks/types";
import {
  normalizeName,
  parseMovementsWorkbook,
  type ParseError,
} from "@/lib/finance/xlsx-import";
import { resolveCurrentOrganizationId } from "@/lib/organization/current";
import { requireRole } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

import { translateBankMovementError } from "./translate-error";

// ═══════════════════════════════════════════════════════════════════════════
// Server actions para bank_movements desde Kingrow — post 0101, org-scope.
//
// Delete: permitido solo si el movimiento NO está vinculado a expenses,
// invoices, payroll ni client_transfers. Todas las FKs son ON DELETE SET
// NULL, así que borrarlo con links dejaría el satélite en estado
// inconsistente (paid_at seteado pero bank_movement_id=NULL, sin forma de
// re-vincular desde la UI). Si el movimiento está linkeado, hay que
// desvincularlo primero desde el módulo correspondiente.
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

export type DeleteBankMovementResult = { ok: true } | { error: string };

export type BulkDeleteBankMovementsResult =
  | { ok: true; deleted: number }
  | { error: string };

interface BankMovementPayload {
  readonly bankId: string;
  readonly kind: BankMovementKind;
  readonly amount: number;
  readonly occurredAt: string;
  readonly description: string | null;
  readonly transactionNumber: string | null;
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

  const txRaw = String(formData.get("transaction_number") ?? "").trim();
  const transactionNumber = txRaw.length === 0 ? null : txRaw;

  return { bankId, kind, amount, occurredAt, description, transactionNumber };
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
    transaction_number: parsed.transactionNumber,
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
    transaction_number: parsed.transactionNumber,
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

// ═══════════════════════════════════════════════════════════════════════════
// deleteBankMovement — solo si no está vinculado a nada
// ═══════════════════════════════════════════════════════════════════════════
//
// Chequea manualmente expenses / invoices / payroll / client_transfers antes
// de borrar. Las FKs son ON DELETE SET NULL, así que la DB no rebota — el
// guard es exclusivamente aplicativo. Si hay algún link, devolvemos un
// mensaje que le dice al operador dónde tiene que ir a desvincular primero.

export async function deleteBankMovement(
  movementId: string,
): Promise<DeleteBankMovementResult> {
  await requireRole("superadmin");

  if (!movementId) return { error: "Falta el id del movimiento." };

  const supabase = await createClient();

  // Chequeo de existencia + org via RLS. Si RLS lo esconde, maybeSingle
  // devuelve null y avisamos claro.
  const { data: existing } = await supabase
    .from("bank_movements")
    .select("id")
    .eq("id", movementId)
    .maybeSingle();
  if (!existing) {
    return { error: "El movimiento ya no existe o no tenés acceso." };
  }

  const linkChecks = await Promise.all([
    supabase
      .from("expenses")
      .select("id", { count: "exact", head: true })
      .eq("bank_movement_id", movementId),
    supabase
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("bank_movement_id", movementId),
    supabase
      .from("payroll")
      .select("id", { count: "exact", head: true })
      .eq("bank_movement_id", movementId),
    supabase
      .from("client_transfers")
      .select("id", { count: "exact", head: true })
      .eq("bank_movement_id", movementId),
  ]);

  const [expenses, invoices, payroll, transfers] = linkChecks;
  const linked: string[] = [];
  if ((expenses.count ?? 0) > 0) linked.push(`${expenses.count} gasto(s)`);
  if ((invoices.count ?? 0) > 0) linked.push(`${invoices.count} factura(s)`);
  if ((payroll.count ?? 0) > 0) linked.push(`${payroll.count} liquidación(es) de nómina`);
  if ((transfers.count ?? 0) > 0) linked.push(`${transfers.count} transferencia(s) a cliente`);

  if (linked.length > 0) {
    return {
      error:
        `No se puede eliminar: este movimiento está vinculado a ${linked.join(", ")}. ` +
        `Desvinculá primero desde el módulo correspondiente (por ej. "Desvincular pago" en Gastos) y volvé a intentar.`,
    };
  }

  const { error } = await supabase
    .from("bank_movements")
    .delete()
    .eq("id", movementId);

  if (error) return { error: translateBankMovementError(error) };

  revalidatePath("/financiero/movimientos");
  revalidatePath("/financiero/bancos");
  revalidatePath("/financiero/gastos");
  revalidatePath("/financiero");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// bulkDeleteBankMovements — borrado masivo, rompe conciliaciones primero
// ═══════════════════════════════════════════════════════════════════════════
//
// A diferencia del delete individual (guardado por links), este action asume
// que el operador quiere nuclearizar. Caso de uso: re-importar movimientos
// desde cero. Antes de borrar los movimientos:
//   - Vacía expense_bank_movements y invoice_bank_movements (bridges N:M).
//     Los triggers recompute_*_paid_at limpian paid_at/bank_movement_id en
//     los satélites afectados.
//   - Pone bank_movement_id = NULL en payroll y client_transfers (FKs 1:1
//     directas — no hay bridge intermedia).
// Después borra los movimientos.
//
// Batched en chunks de 500 para no explotar el URL de PostgREST.

const BULK_DELETE_BATCH_SIZE = 500;

export async function bulkDeleteBankMovements(
  movementIds: readonly string[],
): Promise<BulkDeleteBankMovementsResult> {
  await requireRole("superadmin");

  const ids = Array.from(new Set(movementIds.filter((id) => id.length > 0)));
  if (ids.length === 0) return { error: "No hay movimientos seleccionados." };

  const supabase = await createClient();

  let deleted = 0;
  for (let i = 0; i < ids.length; i += BULK_DELETE_BATCH_SIZE) {
    const slice = ids.slice(i, i + BULK_DELETE_BATCH_SIZE);

    // 1. Romper bridges N:M (dispara recompute_*_paid_at)
    const [expBridgeRes, invBridgeRes] = await Promise.all([
      supabase
        .from("expense_bank_movements")
        .delete()
        .in("bank_movement_id", slice),
      supabase
        .from("invoice_bank_movements")
        .delete()
        .in("bank_movement_id", slice),
    ]);
    if (expBridgeRes.error) {
      return { error: translateBankMovementError(expBridgeRes.error) };
    }
    if (invBridgeRes.error) {
      return { error: translateBankMovementError(invBridgeRes.error) };
    }

    // 2. Null-out en FKs 1:1
    const [payRes, ctRes] = await Promise.all([
      supabase
        .from("payroll")
        .update({ bank_movement_id: null } as never)
        .in("bank_movement_id", slice),
      supabase
        .from("client_transfers")
        .update({ bank_movement_id: null } as never)
        .in("bank_movement_id", slice),
    ]);
    if (payRes.error) return { error: translateBankMovementError(payRes.error) };
    if (ctRes.error) return { error: translateBankMovementError(ctRes.error) };

    // 3. Borrar los movimientos
    const { data, error } = await supabase
      .from("bank_movements")
      .delete()
      .in("id", slice)
      .select("id");

    if (error) return { error: translateBankMovementError(error) };
    deleted += (data as { id: string }[] | null)?.length ?? 0;
  }

  revalidatePath("/financiero/movimientos");
  revalidatePath("/financiero/bancos");
  revalidatePath("/financiero/gastos");
  revalidatePath("/financiero/facturas");
  revalidatePath("/financiero/nomina");
  revalidatePath("/financiero/transferencias");
  revalidatePath("/financiero");
  return { ok: true, deleted };
}

// ═══════════════════════════════════════════════════════════════════════════
// Import xlsx — preview (dry-run) + confirm (insert batched)
// ═══════════════════════════════════════════════════════════════════════════
//
// Igual que el import de leads: dos pasos, archivo se re-sube porque las
// server actions no persisten binarios entre calls. Sin mapping — usamos la
// plantilla con headers fijos ("Banco", "Tipo", "Monto", "Fecha", "Descripción").
//
// Estrategia de match del banco: `banks.name` normalizado (lower, sin acentos,
// sin espacios extra). Si el nombre no matchea NINGÚN banco visible por RLS,
// la fila se marca como error y no se inserta.

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

async function loadBanksByName(): Promise<Map<string, string>> {
  const supabase = await createClient();
  const { data } = await supabase.from("banks").select("id, name");
  const map = new Map<string, string>();
  for (const b of ((data ?? []) as unknown as { id: string; name: string }[])) {
    map.set(normalizeName(b.name), b.id);
  }
  return map;
}

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

export async function previewMovementsImport(
  _prev: ImportPreviewResult | null,
  formData: FormData,
): Promise<ImportPreviewResult> {
  await requireRole("superadmin");

  const fileRes = await readXlsxFile(formData);
  if (!fileRes.ok) return { ok: false, error: fileRes.error };

  try {
    const banksByName = await loadBanksByName();
    const parsed = await parseMovementsWorkbook(fileRes.buffer, banksByName);
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

export async function confirmMovementsImport(
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
    const banksByName = await loadBanksByName();
    const parsed = await parseMovementsWorkbook(fileRes.buffer, banksByName);
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

    const { data: userData } = await supabase.auth.getUser();
    const createdBy = userData.user?.id ?? null;

    const insertErrors: ParseError[] = [];
    let imported = 0;

    for (let i = 0; i < parsed.rows.length; i += IMPORT_BATCH_SIZE) {
      const slice = parsed.rows.slice(i, i + IMPORT_BATCH_SIZE);
      const payload = slice.map((r) => ({
        bank_id: r.bank_id,
        organization_id: organizationId,
        kind: r.kind as BankMovementKind,
        amount: r.amount,
        occurred_at: r.occurred_at,
        description: r.description,
        transaction_number: r.transaction_number,
        created_by: createdBy,
      })) as never;

      const { data, error } = await supabase
        .from("bank_movements")
        .insert(payload)
        .select("id");

      if (error) {
        insertErrors.push({
          rowNumber: i + 2,
          reason: `Batch: ${translateBankMovementError(error)}`,
        });
        continue;
      }
      imported += data?.length ?? 0;
    }

    revalidatePath("/financiero/movimientos");
    revalidatePath("/financiero/bancos");
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
