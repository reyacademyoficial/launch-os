"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

import { translatePaymentMethodError } from "./translate-error";

// ═══════════════════════════════════════════════════════════════════════════
// Server actions para payment_methods desde Kingrow — org-wide con selector
// de proyecto en el drawer.
//
// El schema sigue project-scope (0043 + 0044): cada método pertenece a UN
// proyecto y opcionalmente a un banco de Kingrow. Con RLS project-scope,
// superadmin ve todos por is_kingrow_admin() → esto se acepta como scope
// efectivo en Kingrow.
//
// Delete: PERMITIDO condicionalmente. El schema tiene payments.payment_method_id
// ON DELETE RESTRICT — si hay cobros, la DB rechaza y translate-error empuja
// al toggle active. Coincide con la política de LaunchOS actual.
// ═══════════════════════════════════════════════════════════════════════════

export type CreatePaymentMethodState =
  | { ok: true; methodId: string }
  | { error: string }
  | null;

export type UpdatePaymentMethodState = { ok: true } | { error: string } | null;

export type SetPaymentMethodActiveResult = { ok: true } | { error: string };

export type DeletePaymentMethodResult = { ok: true } | { error: string };

interface PaymentMethodPayload {
  readonly projectId: string;
  readonly name: string;
  readonly bankId: string | null;
  /**
   * Solo se persiste cuando el método NO tiene banco. Con banco, la moneda
   * efectiva se hereda del banco al leer — la columna del método queda null
   * para evitar dos fuentes de verdad que puedan divergir.
   */
  readonly currency: "ARS" | "USD" | null;
}

function parseFormData(formData: FormData): PaymentMethodPayload | string {
  const projectId = String(formData.get("project_id") ?? "").trim();
  if (projectId.length === 0) return "Elegí un proyecto.";

  const name = String(formData.get("name") ?? "").trim();
  if (name.length === 0) return "El nombre del método es obligatorio.";

  const bankRaw = String(formData.get("bank_id") ?? "").trim();
  const bankId = bankRaw.length === 0 ? null : bankRaw;

  let currency: "ARS" | "USD" | null = null;
  if (bankId === null) {
    const raw = String(formData.get("currency") ?? "").trim();
    if (raw !== "ARS" && raw !== "USD") {
      return "Elegí la moneda del método (obligatorio cuando no tiene banco).";
    }
    currency = raw;
  }

  return { projectId, name, bankId, currency };
}

// ═══════════════════════════════════════════════════════════════════════════
// createPaymentMethod
// ═══════════════════════════════════════════════════════════════════════════

export async function createPaymentMethod(
  _prev: CreatePaymentMethodState,
  formData: FormData,
): Promise<CreatePaymentMethodState> {
  await requireRole("superadmin");

  const parsed = parseFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createClient();

  // Sanity check del bank_id si viene: existe a nivel org (RLS ya filtra).
  if (parsed.bankId) {
    const { data } = await supabase
      .from("banks")
      .select("id")
      .eq("id", parsed.bankId)
      .maybeSingle();
    if (!data) return { error: "El banco elegido no existe." };
  }

  const payload = {
    project_id: parsed.projectId,
    name: parsed.name,
    bank_id: parsed.bankId,
    currency: parsed.currency,
    active: true,
  } as never;

  const { data, error } = await supabase
    .from("payment_methods")
    .insert(payload)
    .select("id")
    .single();

  if (error) return { error: translatePaymentMethodError(error) };
  const created = data as { id: string } | null;
  if (!created) return { error: "El insert no devolvió fila." };

  revalidatePath("/financiero/metodos-pago");
  revalidatePath("/financiero/bancos");
  revalidatePath("/financiero");
  // Preservamos revalidación de la ruta LaunchOS de leads porque el dropdown
  // de método de pago se lee ahí al cargar cobros.
  revalidatePath(`/proyectos/${parsed.projectId}/leads`);
  return { ok: true, methodId: created.id };
}

// ═══════════════════════════════════════════════════════════════════════════
// updatePaymentMethod — el projectId NO se puede cambiar
// ═══════════════════════════════════════════════════════════════════════════
//
// Cambiar el proyecto de un método rompería la relación con los cobros
// históricos (payments.payment_method_id apunta a este método, y los payments
// son del proyecto original). Si aparece la necesidad, se hace "borrar el
// viejo + crear nuevo" — mismo criterio que updateBankMovement con bank_id.

export async function updatePaymentMethod(
  methodId: string,
  _prev: UpdatePaymentMethodState,
  formData: FormData,
): Promise<UpdatePaymentMethodState> {
  await requireRole("superadmin");

  const parsed = parseFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createClient();

  if (parsed.bankId) {
    const { data } = await supabase
      .from("banks")
      .select("id")
      .eq("id", parsed.bankId)
      .maybeSingle();
    if (!data) return { error: "El banco elegido no existe." };
  }

  const payload = {
    name: parsed.name,
    bank_id: parsed.bankId,
    currency: parsed.currency,
    // project_id NO se toca — ver comentario.
  } as never;

  const { error } = await supabase
    .from("payment_methods")
    .update(payload)
    .eq("id", methodId);

  if (error) return { error: translatePaymentMethodError(error) };

  revalidatePath("/financiero/metodos-pago");
  revalidatePath("/financiero/bancos");
  revalidatePath("/financiero");
  revalidatePath(`/proyectos/${parsed.projectId}/leads`);
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// setPaymentMethodActive — dar de baja / reactivar (sin borrar)
// ═══════════════════════════════════════════════════════════════════════════
//
// Camino recomendado para "eliminar" un método que ya tiene cobros: se
// desactiva. Los cobros históricos quedan trazables al método, pero el
// método no aparece más para NUEVOS cobros. Coincide con la UX de banks.

export async function setPaymentMethodActive(
  methodId: string,
  active: boolean,
): Promise<SetPaymentMethodActiveResult> {
  await requireRole("superadmin");

  const supabase = await createClient();
  const payload = { active } as never;

  const { error } = await supabase
    .from("payment_methods")
    .update(payload)
    .eq("id", methodId);

  if (error) return { error: translatePaymentMethodError(error) };

  revalidatePath("/financiero/metodos-pago");
  revalidatePath("/financiero");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// deletePaymentMethod — permitido si no hay cobros (RESTRICT en DB)
// ═══════════════════════════════════════════════════════════════════════════
//
// Camino solo para métodos NUEVOS que se cargaron por error. Si el método
// ya tiene cobros, la DB rechaza con 23503 → translate-error explica el
// alternativa.

export async function deletePaymentMethod(
  methodId: string,
): Promise<DeletePaymentMethodResult> {
  await requireRole("superadmin");

  const supabase = await createClient();
  const { error } = await supabase
    .from("payment_methods")
    .delete()
    .eq("id", methodId);

  if (error) return { error: translatePaymentMethodError(error) };

  revalidatePath("/financiero/metodos-pago");
  revalidatePath("/financiero");
  return { ok: true };
}
