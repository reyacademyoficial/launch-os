"use server";

import { revalidatePath } from "next/cache";

import { resolveCurrentOrganizationId } from "@/lib/organization/current";
import { createClient } from "@/lib/supabase/server";

// ═══════════════════════════════════════════════════════════════════════════
// Contratos de retorno — patrón discriminated union del resto del módulo
// ═══════════════════════════════════════════════════════════════════════════

export type CreatePayrollState =
  | { ok: true; payrollId: string }
  | { error: string }
  | null;

export type UpdatePayrollState = { ok: true } | { error: string } | null;

export type LinkPayrollResult = { ok: true } | { error: string };

export type DeletePayrollResult = { ok: true } | { error: string };

/**
 * Roles del bridge `payroll_bank_movements` (mig 0129) — mismo shape que
 * `expense_bank_movements` (0119). Un sueldo se paga con UN principal
 * (kind='out') + N comisiones bancarias (kind='out') + ajustes ocasionales.
 */
export type PayrollMovementRole = "principal" | "comision" | "otro";

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

const YMD_RX = /^\d{4}-\d{2}-\d{2}$/;

function isYmd(s: string): boolean {
  return YMD_RX.test(s);
}

/**
 * Parsea el jsonb `extras` que envía el drawer como string. Formato aceptado:
 * `[{ label: "Aguinaldo", amount: 5000 }, { label: "Descuento", amount: -800 }]`.
 * Convierte a `{ [label]: amount }` — el shape sugerido por la doc de 0066
 * (aguinaldo, bonus_produccion, retencion_ganancias, etc.). Si viene malformado
 * devuelve `{}` (sin extras) para no romper el flujo por un typo.
 */
function parseExtras(raw: string): Record<string, number> {
  if (raw.trim().length === 0) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const item of parsed) {
      if (typeof item !== "object" || item === null) continue;
      const label = String(
        (item as { label?: unknown }).label ?? "",
      ).trim();
      const amount = Number((item as { amount?: unknown }).amount);
      if (label.length === 0 || !Number.isFinite(amount)) continue;
      // Colapsa labels repetidos sumando — el humano puede querer dos filas
      // "Bonos" (una +1000, otra +500) y contablemente son la misma partida.
      out[label] = (out[label] ?? 0) + amount;
    }
    return out;
  } catch {
    return {};
  }
}

function sumExtras(extras: Record<string, number>): number {
  return Object.values(extras).reduce((acc, n) => acc + n, 0);
}

// ═══════════════════════════════════════════════════════════════════════════
// Payload compartido create/update — mismo shape, dos writes distintos
// ═══════════════════════════════════════════════════════════════════════════

interface PayrollPayload {
  readonly personId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly baseSalary: number;
  readonly extras: Record<string, number>;
  readonly totalAmount: number;
  readonly currency: "ARS" | "USD";
  readonly dueDate: string | null;
  readonly notes: string | null;
}

/** Devuelve el payload validado, o un string con el mensaje de error. */
function parsePayrollFormData(formData: FormData): PayrollPayload | string {
  const personId = String(formData.get("person_id") ?? "").trim();
  if (personId.length === 0) return "Elegí una persona.";

  const periodStart = String(formData.get("period_start") ?? "").trim();
  const periodEnd = String(formData.get("period_end") ?? "").trim();
  if (!isYmd(periodStart) || !isYmd(periodEnd)) {
    return "El período tiene que tener fecha de inicio y fin válidas.";
  }
  if (periodEnd < periodStart) {
    return "El fin del período no puede ser anterior al inicio.";
  }

  const baseSalary = Number(formData.get("base_salary"));
  if (!Number.isFinite(baseSalary) || baseSalary < 0) {
    return "El sueldo base tiene que ser un número positivo o cero.";
  }

  const extras = parseExtras(String(formData.get("extras") ?? ""));
  const totalAmount = baseSalary + sumExtras(extras);
  if (totalAmount < 0) {
    return "El total neto no puede quedar negativo. Revisá los descuentos vs. el sueldo base.";
  }

  const currency =
    String(formData.get("currency") ?? "ARS").trim() === "USD" ? "USD" : "ARS";

  const dueDateRaw = String(formData.get("due_date") ?? "").trim();
  const dueDate = dueDateRaw.length === 0 ? null : dueDateRaw;
  if (dueDate != null && !isYmd(dueDate)) {
    return "La fecha de vencimiento no es válida.";
  }

  const notesRaw = String(formData.get("notes") ?? "").trim();
  const notes = notesRaw.length === 0 ? null : notesRaw;

  return {
    personId,
    periodStart,
    periodEnd,
    baseSalary,
    extras,
    totalAmount,
    currency,
    dueDate,
    notes,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// createPayroll
// ═══════════════════════════════════════════════════════════════════════════

export async function createPayroll(
  _prev: CreatePayrollState,
  formData: FormData,
): Promise<CreatePayrollState> {
  const parsed = parsePayrollFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  let organizationId: string | null;
  try {
    organizationId = await resolveCurrentOrganizationId();
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Error resolviendo la organización.",
    };
  }
  if (!organizationId) {
    return { error: "No pudimos resolver tu organización. Revisá tus permisos." };
  }

  const supabase = await createClient();
  const payload = {
    organization_id: organizationId,
    person_id: parsed.personId,
    period_start: parsed.periodStart,
    period_end: parsed.periodEnd,
    base_salary: parsed.baseSalary,
    extras: parsed.extras,
    total_amount: parsed.totalAmount,
    currency: parsed.currency,
    due_date: parsed.dueDate,
    notes: parsed.notes,
  } as never;

  const { data, error } = await supabase
    .from("payroll")
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    // Unique (person_id, period_start, period_end) — evita cargar dos veces
    // la misma liquidación por error.
    if (error.code === "23505") {
      return {
        error:
          "Ya existe una liquidación de esta persona para ese mismo período. Editá la existente en vez de crear una nueva.",
      };
    }
    return { error: error.message };
  }

  const created = data as { id: string } | null;
  if (!created) return { error: "El insert no devolvió fila." };

  revalidatePath("/financiero/nomina");
  revalidatePath("/financiero");
  return { ok: true, payrollId: created.id };
}

// ═══════════════════════════════════════════════════════════════════════════
// updatePayroll — modifica una liquidación existente
// ═══════════════════════════════════════════════════════════════════════════
//
// Editar liquidaciones ya vinculadas (paid_at != null) NO se bloquea: el
// operador puede necesitar ajustar el nombre de una nota o un extra sin
// desvincular el pago. Lo que sí actualiza el total_amount recalculado, así
// que si cambia el base o los extras después del pago, el total refleja lo
// nuevo aunque el bank_movement quede con el monto original — el desfasaje
// aparece como diferencia entre "vinculado" y "monto real". Es información,
// no error.

export async function updatePayroll(
  payrollId: string,
  _prev: UpdatePayrollState,
  formData: FormData,
): Promise<UpdatePayrollState> {
  if (!payrollId) return { error: "Falta el id de la liquidación." };

  const parsed = parsePayrollFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createClient();
  const payload = {
    person_id: parsed.personId,
    period_start: parsed.periodStart,
    period_end: parsed.periodEnd,
    base_salary: parsed.baseSalary,
    extras: parsed.extras,
    total_amount: parsed.totalAmount,
    currency: parsed.currency,
    due_date: parsed.dueDate,
    notes: parsed.notes,
  } as never;

  const { error } = await supabase
    .from("payroll")
    .update(payload)
    .eq("id", payrollId);

  if (error) {
    if (error.code === "23505") {
      return {
        error:
          "Ya existe otra liquidación de esa persona para ese mismo período.",
      };
    }
    return { error: error.message };
  }

  revalidatePath("/financiero/nomina");
  revalidatePath("/financiero");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// deletePayroll — bloquea si la liquidación está vinculada a un pago
// ═══════════════════════════════════════════════════════════════════════════
//
// Mismo criterio que deleteExpense (gastos/actions.ts): si hay link
// (paid_at + bank_movement_id o bridge no vacío), el operador tiene que
// desvincular primero desde "Ver pago". Sin este guard, un borrado silencioso
// deja el bank_movement huérfano sin traza de la liquidación que lo
// justificaba — imposible de auditar después.

export async function deletePayroll(
  payrollId: string,
): Promise<DeletePayrollResult> {
  if (!payrollId) return { error: "Falta el id de la liquidación." };

  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("payroll")
    .select("id, paid_at, bank_movement_id")
    .eq("id", payrollId)
    .maybeSingle();
  if (!existing) {
    return { error: "La liquidación ya no existe o no tenés acceso." };
  }

  const row = existing as {
    id: string;
    paid_at: string | null;
    bank_movement_id: string | null;
  };

  // Post 0129: el guard también mira el bridge — un sueldo con sólo comisión
  // linkeada (sin principal) puede tener paid_at=null pero seguir vinculado.
  const { count: bridgeCount } = await supabase
    .from("payroll_bank_movements")
    .select("payroll_id", { count: "exact", head: true })
    .eq("payroll_id", payrollId);

  if (
    row.paid_at != null ||
    row.bank_movement_id != null ||
    (bridgeCount ?? 0) > 0
  ) {
    return {
      error:
        "No se puede eliminar: la liquidación está vinculada a un movimiento bancario. " +
        'Desvinculá primero desde "Ver pago" y volvé a intentar.',
    };
  }

  const { error } = await supabase
    .from("payroll")
    .delete()
    .eq("id", payrollId);

  if (error) return { error: error.message };

  revalidatePath("/financiero/nomina");
  revalidatePath("/financiero");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// linkPayrollToMovement — inserta fila en payroll_bank_movements (mig 0129)
// ═══════════════════════════════════════════════════════════════════════════
//
// Post 0129 la nómina puede tener N movimientos: principal (el sueldo saliendo
// del banco) + comisión (fee bancario del pago del sueldo, típicamente
// transferencia al empleado) + otro (ajustes puntuales). El trigger
// recompute_payroll_paid_at setea paid_at = MAX(occurred_at) de los principales
// vinculados.
//
// Guards:
//   - Misma organización (RLS también lo bloquearía).
//   - role='principal' requiere kind='out' (un sueldo no se paga con una
//     entrada).
//   - role='comision' u 'otro' aceptan cualquier kind.

export async function linkPayrollToMovement(
  payrollId: string,
  bankMovementId: string,
  role: PayrollMovementRole = "principal",
): Promise<LinkPayrollResult> {
  if (!payrollId || !bankMovementId) {
    return { error: "Falta payroll_id o bank_movement_id." };
  }

  const supabase = await createClient();

  const [{ data: pRow }, { data: bmRow }] = await Promise.all([
    supabase
      .from("payroll")
      .select("id, organization_id")
      .eq("id", payrollId)
      .maybeSingle(),
    supabase
      .from("bank_movements")
      .select("id, kind, organization_id")
      .eq("id", bankMovementId)
      .maybeSingle(),
  ]);
  const pay = pRow as { id: string; organization_id: string } | null;
  const bm = bmRow as
    | { id: string; kind: "in" | "out"; organization_id: string }
    | null;
  if (!pay) return { error: "La liquidación ya no existe o no tenés acceso." };
  if (!bm) return { error: "El movimiento ya no existe o no tenés acceso." };
  if (pay.organization_id !== bm.organization_id) {
    return { error: "Nómina y movimiento son de organizaciones distintas." };
  }
  if (role === "principal" && bm.kind !== "out") {
    return {
      error:
        "El movimiento elegido es una ENTRADA. Solo las salidas pueden pagar un sueldo (role='principal'). Elegí role='comision' u 'otro' para vincular entradas (reembolsos).",
    };
  }

  const { error } = await supabase
    .from("payroll_bank_movements")
    .insert({
      payroll_id: payrollId,
      bank_movement_id: bankMovementId,
      role,
    } as never);

  if (error) {
    if (error.code === "23505") {
      return { error: "Ese movimiento ya está vinculado a esta liquidación." };
    }
    return { error: error.message };
  }

  revalidatePath("/financiero/nomina");
  revalidatePath("/financiero/movimientos");
  revalidatePath("/financiero/bancos");
  revalidatePath("/financiero");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// unlinkPayrollFromMovement — borra fila del bridge; trigger recomputa paid_at
// ═══════════════════════════════════════════════════════════════════════════

export async function unlinkPayrollFromMovement(
  payrollId: string,
  bankMovementId: string,
): Promise<LinkPayrollResult> {
  if (!payrollId || !bankMovementId) {
    return { error: "Falta payroll_id o bank_movement_id." };
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from("payroll_bank_movements")
    .delete()
    .eq("payroll_id", payrollId)
    .eq("bank_movement_id", bankMovementId);

  if (error) return { error: error.message };

  revalidatePath("/financiero/nomina");
  revalidatePath("/financiero/movimientos");
  revalidatePath("/financiero/bancos");
  revalidatePath("/financiero");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// unlinkPayrollPayment — compat shim: borra TODO el bridge del sueldo
// ═══════════════════════════════════════════════════════════════════════════
//
// La firma vieja no tomaba movementId. El trigger recompute_payroll_paid_at
// al quedar el bridge vacío limpia paid_at. Además limpia la FK vieja
// `payroll.bank_movement_id` (que la UI legacy pudiera haber seteado) para
// que la fila quede consistentemente "impaga".

export async function unlinkPayrollPayment(
  payrollId: string,
): Promise<LinkPayrollResult> {
  const supabase = await createClient();

  const { error: bridgeErr } = await supabase
    .from("payroll_bank_movements")
    .delete()
    .eq("payroll_id", payrollId);
  if (bridgeErr) return { error: bridgeErr.message };

  // Compat con la col vieja: si venía seteada por la UI legacy, la limpiamos
  // también. Con bridge vacío, el trigger ya no toca paid_at (regla del 0129),
  // así que el UPDATE explícito es lo que garantiza el estado impago.
  const payload = {
    paid_at: null,
    bank_movement_id: null,
  } as never;

  const { error } = await supabase
    .from("payroll")
    .update(payload)
    .eq("id", payrollId);

  if (error) return { error: error.message };

  revalidatePath("/financiero/nomina");
  revalidatePath("/financiero/movimientos");
  revalidatePath("/financiero/bancos");
  revalidatePath("/financiero");
  return { ok: true };
}
