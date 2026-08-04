"use server";

import { revalidatePath } from "next/cache";

import type { UpsellStatus } from "@/lib/clients/types";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

// ═══════════════════════════════════════════════════════════════════════════
// CRUD de upsells (bloque 3 · 0084/0110).
//
// Upsell = venta adicional a un cliente existente. Distinto de renewal
// (contrato periódico) y de invoices (fee suelto). Un upsell tiene un
// título (qué se vendió), monto y status con la misma máquina de estados
// que renewals.
//
// INVARIANTES DE 0084 que respeta este action:
//   - status='cobrada' ↔ closed_at IS NOT NULL
//   - loss_reason SOLO si status='perdida'
//
// Mismo manejo transparente que renewals (cobrada sin fecha → hoy, etc.).
// ═══════════════════════════════════════════════════════════════════════════

export type CreateUpsellState =
  | { ok: true; upsellId: string }
  | { error: string }
  | null;

export type UpdateUpsellState = { ok: true } | { error: string } | null;

export type DeleteUpsellResult = { ok: true } | { error: string };

const STATUSES: readonly UpsellStatus[] = [
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

interface UpsellPayload {
  readonly clientId: string;
  readonly title: string;
  readonly description: string | null;
  readonly category: string | null;
  readonly amount: number;
  readonly currency: "ARS" | "USD";
  readonly status: UpsellStatus;
  readonly closedAt: string | null;
  readonly lossReason: string | null;
  readonly notes: string | null;
}

function parseUpsellFormData(formData: FormData): UpsellPayload | string {
  const clientId = String(formData.get("client_id") ?? "").trim();
  if (clientId.length === 0) return "Elegí un cliente.";

  const title = String(formData.get("title") ?? "").trim();
  if (title.length === 0) return "El título es obligatorio.";
  if (title.length > 300) {
    return "El título es demasiado largo (máximo 300 caracteres).";
  }

  const description = nullIfEmpty(formData.get("description"));
  const category = nullIfEmpty(formData.get("category"));

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
  const status = statusRaw as UpsellStatus;

  const closedAtRaw = nullIfEmpty(formData.get("closed_at"));
  const lossReasonRaw = nullIfEmpty(formData.get("loss_reason"));

  let closedAt: string | null = null;
  let lossReason: string | null = null;

  if (status === "cobrada") {
    if (closedAtRaw != null) {
      if (!YMD_RX.test(closedAtRaw)) {
        return "La fecha de cierre no es válida.";
      }
      closedAt = closedAtRaw;
    } else {
      closedAt = todayYmd();
    }
  } else if (status === "perdida") {
    lossReason = lossReasonRaw;
  }

  const notes = nullIfEmpty(formData.get("notes"));

  return {
    clientId,
    title,
    description,
    category,
    amount,
    currency,
    status,
    closedAt,
    lossReason,
    notes,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// createUpsell
// ═══════════════════════════════════════════════════════════════════════════

export async function createUpsell(
  _prev: CreateUpsellState,
  formData: FormData,
): Promise<CreateUpsellState> {
  const parsed = parseUpsellFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createSupabaseClient();
  const payload = {
    client_id: parsed.clientId,
    title: parsed.title,
    description: parsed.description,
    category: parsed.category,
    amount: parsed.amount,
    currency: parsed.currency,
    status: parsed.status,
    closed_at: parsed.closedAt,
    loss_reason: parsed.lossReason,
    notes: parsed.notes,
  } as never;

  const { data, error } = await supabase
    .from("upsells")
    .insert(payload)
    .select("id")
    .single();

  if (error) return { error: error.message };

  const created = data as { id: string } | null;
  if (!created) return { error: "El insert no devolvió fila." };

  revalidatePath("/clientes/upsells");
  revalidatePath("/clientes");
  revalidatePath(`/clientes/${parsed.clientId}`);
  return { ok: true, upsellId: created.id };
}

// ═══════════════════════════════════════════════════════════════════════════
// updateUpsell
// ═══════════════════════════════════════════════════════════════════════════

export async function updateUpsell(
  upsellId: string,
  _prev: UpdateUpsellState,
  formData: FormData,
): Promise<UpdateUpsellState> {
  if (!upsellId) return { error: "Falta el id del upsell." };

  const parsed = parseUpsellFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createSupabaseClient();

  const { data: existing } = await supabase
    .from("upsells")
    .select("client_id")
    .eq("id", upsellId)
    .maybeSingle();
  const prevClientId =
    (existing as { client_id: string } | null)?.client_id ?? null;

  const payload = {
    client_id: parsed.clientId,
    title: parsed.title,
    description: parsed.description,
    category: parsed.category,
    amount: parsed.amount,
    currency: parsed.currency,
    status: parsed.status,
    closed_at: parsed.closedAt,
    loss_reason: parsed.lossReason,
    notes: parsed.notes,
  } as never;

  const { error } = await supabase
    .from("upsells")
    .update(payload)
    .eq("id", upsellId);

  if (error) return { error: error.message };

  revalidatePath("/clientes/upsells");
  revalidatePath("/clientes");
  revalidatePath(`/clientes/${parsed.clientId}`);
  if (prevClientId && prevClientId !== parsed.clientId) {
    revalidatePath(`/clientes/${prevClientId}`);
  }
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// deleteUpsell — hard delete con confirm en el cliente
// ═══════════════════════════════════════════════════════════════════════════

export async function deleteUpsell(
  upsellId: string,
): Promise<DeleteUpsellResult> {
  if (!upsellId) return { error: "Falta el id del upsell." };

  const supabase = await createSupabaseClient();

  const { data: existing } = await supabase
    .from("upsells")
    .select("client_id")
    .eq("id", upsellId)
    .maybeSingle();
  const clientId = (existing as { client_id: string } | null)?.client_id;

  const { error } = await supabase.from("upsells").delete().eq("id", upsellId);
  if (error) return { error: error.message };

  revalidatePath("/clientes/upsells");
  revalidatePath("/clientes");
  if (clientId) revalidatePath(`/clientes/${clientId}`);
  return { ok: true };
}
