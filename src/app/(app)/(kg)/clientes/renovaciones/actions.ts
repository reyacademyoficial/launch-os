"use server";

import { revalidatePath } from "next/cache";

import type { RenewalStatus } from "@/lib/clients/types";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

// ═══════════════════════════════════════════════════════════════════════════
// CRUD de renewals (bloque 3 · 0083/0110).
//
// Renewal = contrato periódico de gestión Kingrow→cliente (MRR/ARR). Cliente
// paga a Kingrow por gestionarlo mes tras mes / trimestre / año. Distinto
// de `invoices` (fee suelto) y de `client_transfers` (plata devuelta al
// externo del split).
//
// INVARIANTES DE 0083 que respeta este action:
//   - period_start <= period_end (validado en action + CHECK en DB)
//   - status='cobrada' ↔ collected_at IS NOT NULL
//   - loss_reason SOLO si status='perdida'
//
// Manejo transparente:
//   - Si status='cobrada' y el operador no puso collected_at → hoy.
//   - Si status='cobrada' y había loss_reason previa → se limpia.
//   - Si status='perdida' → collected_at pasa a null.
//   - Si status otro → collected_at y loss_reason pasan ambos a null.
// ═══════════════════════════════════════════════════════════════════════════

export type CreateRenewalState =
  | { ok: true; renewalId: string }
  | { error: string }
  | null;

export type UpdateRenewalState = { ok: true } | { error: string } | null;

export type DeleteRenewalResult = { ok: true } | { error: string };

const STATUSES: readonly RenewalStatus[] = [
  "propuesta",
  "confirmada",
  "facturada",
  "cobrada",
  "perdida",
];

const YMD_RX = /^\d{4}-\d{2}-\d{2}$/;

function nullIfEmpty(value: FormDataEntryValue | null): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length === 0 ? null : trimmed;
}

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

interface RenewalPayload {
  readonly clientId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly amount: number;
  readonly currency: "ARS" | "USD";
  readonly status: RenewalStatus;
  readonly collectedAt: string | null;
  readonly lossReason: string | null;
  readonly notes: string | null;
}

function parseRenewalFormData(formData: FormData): RenewalPayload | string {
  const clientId = String(formData.get("client_id") ?? "").trim();
  if (clientId.length === 0) return "Elegí un cliente.";

  const periodStart = String(formData.get("period_start") ?? "").trim();
  const periodEnd = String(formData.get("period_end") ?? "").trim();
  if (!YMD_RX.test(periodStart) || !YMD_RX.test(periodEnd)) {
    return "El período tiene que tener inicio y fin válidos.";
  }
  if (periodEnd < periodStart) {
    return "El fin del período no puede ser anterior al inicio.";
  }

  const amountRaw = String(formData.get("amount") ?? "").trim();
  const amount = Number(amountRaw.replace(",", "."));
  if (!Number.isFinite(amount) || amount < 0) {
    return "El monto tiene que ser un número positivo o cero.";
  }

  const currency =
    String(formData.get("currency") ?? "ARS").trim() === "USD" ? "USD" : "ARS";

  const statusRaw = String(formData.get("status") ?? "").trim();
  if (!(STATUSES as readonly string[]).includes(statusRaw)) {
    return "Estado inválido.";
  }
  const status = statusRaw as RenewalStatus;

  // Manejo del par (collected_at, loss_reason) según status.
  const collectedAtRaw = nullIfEmpty(formData.get("collected_at"));
  const lossReasonRaw = nullIfEmpty(formData.get("loss_reason"));

  let collectedAt: string | null = null;
  let lossReason: string | null = null;

  if (status === "cobrada") {
    if (collectedAtRaw != null) {
      if (!YMD_RX.test(collectedAtRaw)) {
        return "La fecha de cobro no es válida.";
      }
      collectedAt = collectedAtRaw;
    } else {
      // Cobrada sin fecha explícita → default hoy. Evita el rebote del
      // CHECK constraint sin obligar al operador a repetir "hoy" cada vez.
      collectedAt = todayYmd();
    }
  } else if (status === "perdida") {
    lossReason = lossReasonRaw;
  }

  const notes = nullIfEmpty(formData.get("notes"));

  return {
    clientId,
    periodStart,
    periodEnd,
    amount,
    currency,
    status,
    collectedAt,
    lossReason,
    notes,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// createRenewal
// ═══════════════════════════════════════════════════════════════════════════

export async function createRenewal(
  _prev: CreateRenewalState,
  formData: FormData,
): Promise<CreateRenewalState> {
  const parsed = parseRenewalFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createSupabaseClient();
  const payload = {
    client_id: parsed.clientId,
    period_start: parsed.periodStart,
    period_end: parsed.periodEnd,
    amount: parsed.amount,
    currency: parsed.currency,
    status: parsed.status,
    collected_at: parsed.collectedAt,
    loss_reason: parsed.lossReason,
    notes: parsed.notes,
  } as never;

  const { data, error } = await supabase
    .from("renewals")
    .insert(payload)
    .select("id")
    .single();

  if (error) return { error: error.message };

  const created = data as { id: string } | null;
  if (!created) return { error: "El insert no devolvió fila." };

  revalidatePath("/clientes/renovaciones");
  revalidatePath("/clientes");
  revalidatePath(`/clientes/${parsed.clientId}`);
  return { ok: true, renewalId: created.id };
}

// ═══════════════════════════════════════════════════════════════════════════
// updateRenewal
// ═══════════════════════════════════════════════════════════════════════════

export async function updateRenewal(
  renewalId: string,
  _prev: UpdateRenewalState,
  formData: FormData,
): Promise<UpdateRenewalState> {
  if (!renewalId) return { error: "Falta el id de la renewal." };

  const parsed = parseRenewalFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createSupabaseClient();

  // Client_id previo para revalidar la ficha vieja si cambió de cliente.
  const { data: existing } = await supabase
    .from("renewals")
    .select("client_id")
    .eq("id", renewalId)
    .maybeSingle();
  const prevClientId =
    (existing as { client_id: string } | null)?.client_id ?? null;

  const payload = {
    client_id: parsed.clientId,
    period_start: parsed.periodStart,
    period_end: parsed.periodEnd,
    amount: parsed.amount,
    currency: parsed.currency,
    status: parsed.status,
    collected_at: parsed.collectedAt,
    loss_reason: parsed.lossReason,
    notes: parsed.notes,
  } as never;

  const { error } = await supabase
    .from("renewals")
    .update(payload)
    .eq("id", renewalId);

  if (error) return { error: error.message };

  revalidatePath("/clientes/renovaciones");
  revalidatePath("/clientes");
  revalidatePath(`/clientes/${parsed.clientId}`);
  if (prevClientId && prevClientId !== parsed.clientId) {
    revalidatePath(`/clientes/${prevClientId}`);
  }
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// deleteRenewal — hard delete con confirm en el cliente.
//
// Las cobradas cuentan en el LTV, así que borrarlas altera el histórico.
// No bloqueamos porque puede haber errores legítimos (renewal cargada
// duplicada, monto equivocado). El confirm del navegador + la traza en
// audit log (si se agrega en el futuro) cubren el caso.
// ═══════════════════════════════════════════════════════════════════════════

export async function deleteRenewal(
  renewalId: string,
): Promise<DeleteRenewalResult> {
  if (!renewalId) return { error: "Falta el id de la renewal." };

  const supabase = await createSupabaseClient();

  const { data: existing } = await supabase
    .from("renewals")
    .select("client_id")
    .eq("id", renewalId)
    .maybeSingle();
  const clientId = (existing as { client_id: string } | null)?.client_id;

  const { error } = await supabase.from("renewals").delete().eq("id", renewalId);
  if (error) return { error: error.message };

  revalidatePath("/clientes/renovaciones");
  revalidatePath("/clientes");
  if (clientId) revalidatePath(`/clientes/${clientId}`);
  return { ok: true };
}
