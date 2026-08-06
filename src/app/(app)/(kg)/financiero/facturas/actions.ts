"use server";

import { revalidatePath } from "next/cache";

import { resolveCurrentOrganizationId } from "@/lib/organization/current";
import { requireRole } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

import { translateInvoiceError } from "./translate-error";

// ═══════════════════════════════════════════════════════════════════════════
// Server actions para facturas — post 0114.
//
// Alcance manual (este archivo): alta y edición de facturas fee-a-cliente
// externo, y opcionalmente facturas de venta ad-hoc que el operador quiera
// emitir a mano (típicamente si el auto-gen del paso 4 falló o para casos
// edge). La auto-generación desde la venta va por generate_invoices_for_sale
// (paso 4).
//
// Numeración: siempre asignada por next_invoice_number(org_id) — el operador
// NO elige el número. Regla cerrada con Finanzas: talonario único por org,
// arranca en 1, formato 7 dígitos zero-padded.
//
// Borrado: NO se borra. "Anular" cambia status='anulada' preservando el
// registro (importante para auditoría contable).
// ═══════════════════════════════════════════════════════════════════════════

export type CreateInvoiceState =
  | { ok: true; invoiceId: string; invoiceNumber: string }
  | { error: string }
  | null;

export type UpdateInvoiceState = { ok: true } | { error: string } | null;

export type VoidInvoiceResult = { ok: true } | { error: string };

interface InvoicePayload {
  readonly projectId: string | null;
  readonly saleId: string | null;
  readonly productId: string | null;
  readonly description: string;
  readonly category: string | null;
  readonly amountGross: number;
  readonly taxAmount: number;
  readonly currency: string;
  readonly issueDate: string;
  readonly dueDate: string | null;
  readonly purchaseDate: string | null;
  readonly buyerName: string | null;
  readonly buyerEmail: string | null;
  readonly buyerDocument: string | null;
  readonly transactionNumber: string | null;
  readonly notes: string | null;
}

function isYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function optionalYmd(raw: string): string | null | "invalid" {
  const s = raw.trim();
  if (s.length === 0) return null;
  return isYmd(s) ? s : "invalid";
}

function optionalId(raw: string): string | null {
  const s = raw.trim();
  return s.length === 0 ? null : s;
}

function optionalText(raw: string): string | null {
  const s = raw.trim();
  return s.length === 0 ? null : s;
}

function parseInvoiceFormData(formData: FormData): InvoicePayload | string {
  const description = String(formData.get("description") ?? "").trim();
  if (description.length === 0) return "La descripción es obligatoria.";

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
  if (taxAmount > amountGross) {
    return "El IVA no puede superar el monto bruto de la factura.";
  }

  const currencyRaw = String(formData.get("currency") ?? "ARS")
    .trim()
    .toUpperCase();
  const currency = currencyRaw.length > 0 ? currencyRaw : "ARS";

  const issueDate = String(formData.get("issue_date") ?? "").trim();
  if (!isYmd(issueDate)) {
    return "Elegí una fecha de emisión válida.";
  }

  const dueDate = optionalYmd(String(formData.get("due_date") ?? ""));
  if (dueDate === "invalid") return "La fecha de vencimiento no es válida.";
  const purchaseDate = optionalYmd(
    String(formData.get("purchase_date") ?? ""),
  );
  if (purchaseDate === "invalid") return "La fecha de compra no es válida.";

  return {
    projectId: optionalId(String(formData.get("project_id") ?? "")),
    saleId: optionalId(String(formData.get("sale_id") ?? "")),
    productId: optionalId(String(formData.get("product_id") ?? "")),
    description,
    category: optionalText(String(formData.get("category") ?? "")),
    amountGross,
    taxAmount,
    currency,
    issueDate,
    dueDate,
    purchaseDate,
    buyerName: optionalText(String(formData.get("buyer_name") ?? "")),
    buyerEmail: optionalText(String(formData.get("buyer_email") ?? "")),
    buyerDocument: optionalText(String(formData.get("buyer_document") ?? "")),
    transactionNumber: optionalText(
      String(formData.get("transaction_number") ?? ""),
    ),
    notes: optionalText(String(formData.get("notes") ?? "")),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// createInvoice — factura manual
// ═══════════════════════════════════════════════════════════════════════════

export async function createInvoice(
  _prev: CreateInvoiceState,
  formData: FormData,
): Promise<CreateInvoiceState> {
  await requireRole("superadmin");

  const parsed = parseInvoiceFormData(formData);
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
    return {
      error: "No pudimos resolver tu organización. Revisá tus permisos.",
    };
  }

  const supabase = await createClient();

  // Numeración atómica via RPC — talonario único por org. `as never` porque
  // el Database generado no incluye la función hasta próximo `supabase gen types`.
  const nextRes = await supabase.rpc("next_invoice_number" as never, {
    p_org_id: organizationId,
  } as never);
  if (nextRes.error) {
    return { error: `No pudimos asignar número: ${nextRes.error.message}` };
  }
  const invoiceNumber = nextRes.data as unknown as string;

  const { data: userData } = await supabase.auth.getUser();

  const payload = {
    organization_id: organizationId,
    project_id: parsed.projectId,
    sale_id: parsed.saleId,
    installment_id: null, // manual → sin cuota puntual
    product_id: parsed.productId,
    invoice_number: invoiceNumber,
    description: parsed.description,
    category: parsed.category,
    amount_gross: parsed.amountGross,
    tax_amount: parsed.taxAmount,
    currency: parsed.currency,
    issue_date: parsed.issueDate,
    due_date: parsed.dueDate,
    purchase_date: parsed.purchaseDate,
    payment_date: null,
    paid_at: null,
    bank_movement_id: null,
    status: "emitida",
    buyer_name: parsed.buyerName,
    buyer_email: parsed.buyerEmail,
    buyer_document: parsed.buyerDocument,
    transaction_number: parsed.transactionNumber,
    notes: parsed.notes,
    created_by: userData.user?.id ?? null,
  } as never;

  const { data, error } = await supabase
    .from("invoices")
    .insert(payload)
    .select("id")
    .single();

  if (error) return { error: translateInvoiceError(error) };
  const created = data as { id: string } | null;
  if (!created) return { error: "El insert no devolvió fila." };

  revalidatePath("/financiero/facturas");
  revalidatePath("/financiero");
  return { ok: true, invoiceId: created.id, invoiceNumber };
}

// ═══════════════════════════════════════════════════════════════════════════
// updateInvoice — no toca invoice_number, status ni links de cobro
// ═══════════════════════════════════════════════════════════════════════════

export async function updateInvoice(
  invoiceId: string,
  _prev: UpdateInvoiceState,
  formData: FormData,
): Promise<UpdateInvoiceState> {
  await requireRole("superadmin");

  const parsed = parseInvoiceFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createClient();
  const payload = {
    project_id: parsed.projectId,
    sale_id: parsed.saleId,
    product_id: parsed.productId,
    description: parsed.description,
    category: parsed.category,
    amount_gross: parsed.amountGross,
    tax_amount: parsed.taxAmount,
    currency: parsed.currency,
    issue_date: parsed.issueDate,
    due_date: parsed.dueDate,
    purchase_date: parsed.purchaseDate,
    buyer_name: parsed.buyerName,
    buyer_email: parsed.buyerEmail,
    buyer_document: parsed.buyerDocument,
    transaction_number: parsed.transactionNumber,
    notes: parsed.notes,
    // invoice_number, status, paid_at, payment_date, bank_movement_id NO se
    // tocan acá. Anulación → voidInvoice. Cobro → paso 5 (link cobro-factura).
  } as never;

  const { error } = await supabase
    .from("invoices")
    .update(payload)
    .eq("id", invoiceId);

  if (error) return { error: translateInvoiceError(error) };

  revalidatePath("/financiero/facturas");
  revalidatePath("/financiero");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// voidInvoice — status='anulada', preserva el registro
// ═══════════════════════════════════════════════════════════════════════════

export async function voidInvoice(
  invoiceId: string,
): Promise<VoidInvoiceResult> {
  await requireRole("superadmin");

  if (!invoiceId) return { error: "Falta el id de la factura." };

  const supabase = await createClient();

  // No permitimos anular una factura ya cobrada — ese caso pide una nota de
  // crédito o revertir el cobro primero.
  const { data: existing } = await supabase
    .from("invoices")
    .select("id, status")
    .eq("id", invoiceId)
    .maybeSingle();
  const row = existing as { id: string; status: string } | null;
  if (!row) return { error: "La factura ya no existe o no tenés acceso." };
  if (row.status === "cobrada") {
    return {
      error:
        "No se puede anular una factura cobrada. Desvinculá primero el cobro asociado.",
    };
  }
  if (row.status === "anulada") {
    return { error: "La factura ya está anulada." };
  }

  const { error } = await supabase
    .from("invoices")
    .update({ status: "anulada" } as never)
    .eq("id", invoiceId);

  if (error) return { error: translateInvoiceError(error) };

  revalidatePath("/financiero/facturas");
  revalidatePath("/financiero");
  return { ok: true };
}
