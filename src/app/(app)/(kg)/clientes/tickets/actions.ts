"use server";

import { revalidatePath } from "next/cache";

import type { TicketPriority, TicketStatus } from "@/lib/clients/types";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

// ═══════════════════════════════════════════════════════════════════════════
// CRUD de tickets (bloque 3 · 0082/0110).
//
// Un ticket vive con el CLIENTE (client_id NOT NULL). project_id es
// opcional — si el ticket es específico de un launch. El trigger
// set_org_and_check_project valida que si project_id está seteado, el
// project pertenezca al mismo cliente, así que no hace falta re-validar
// acá; el error de la DB rebota con mensaje amable.
//
// Invariante duro de 0082: status ∈ {resuelto, cerrado} ↔ resolved_at
// IS NOT NULL. Manejado transparentemente por la action:
//   - Nuevo status resuelto/cerrado sin resolved_at previo → se setea now().
//   - Nuevo status abierto (cualquier variante) → resolved_at pasa a null.
//   - Status resuelto/cerrado con resolved_at ya seteado → se preserva.
// El operador no ve un campo "resolved_at" en el form.
// ═══════════════════════════════════════════════════════════════════════════

export type CreateTicketState =
  | { ok: true; ticketId: string }
  | { error: string }
  | null;

export type UpdateTicketState = { ok: true } | { error: string } | null;

export type DeleteTicketResult = { ok: true } | { error: string };

const STATUSES: readonly TicketStatus[] = [
  "abierto",
  "en_progreso",
  "esperando_cliente",
  "resuelto",
  "cerrado",
];

const PRIORITIES: readonly TicketPriority[] = [
  "baja",
  "media",
  "alta",
  "urgente",
];

const CLOSED_STATUSES: ReadonlySet<TicketStatus> = new Set([
  "resuelto",
  "cerrado",
]);

const YMD_RX = /^\d{4}-\d{2}-\d{2}$/;

function nullIfEmpty(value: FormDataEntryValue | null): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length === 0 ? null : trimmed;
}

interface TicketPayload {
  readonly clientId: string;
  readonly projectId: string | null;
  readonly assigneePersonId: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly status: TicketStatus;
  readonly priority: TicketPriority;
  readonly category: string | null;
  readonly dueDate: string | null;
}

function parseTicketFormData(formData: FormData): TicketPayload | string {
  const clientId = String(formData.get("client_id") ?? "").trim();
  if (clientId.length === 0) return "Elegí un cliente.";

  const projectId = nullIfEmpty(formData.get("project_id"));

  const assigneePersonId = nullIfEmpty(formData.get("assignee_person_id"));

  const title = String(formData.get("title") ?? "").trim();
  if (title.length === 0) return "El título es obligatorio.";
  if (title.length > 300) return "El título es demasiado largo (máximo 300 caracteres).";

  const description = nullIfEmpty(formData.get("description"));

  const statusRaw = String(formData.get("status") ?? "").trim();
  if (!(STATUSES as readonly string[]).includes(statusRaw)) {
    return "Estado inválido.";
  }
  const status = statusRaw as TicketStatus;

  const priorityRaw = String(formData.get("priority") ?? "").trim();
  if (!(PRIORITIES as readonly string[]).includes(priorityRaw)) {
    return "Prioridad inválida.";
  }
  const priority = priorityRaw as TicketPriority;

  const category = nullIfEmpty(formData.get("category"));

  const dueDate = nullIfEmpty(formData.get("due_date"));
  if (dueDate != null && !YMD_RX.test(dueDate)) {
    return "La fecha de vencimiento no es válida.";
  }

  return {
    clientId,
    projectId,
    assigneePersonId,
    title,
    description,
    status,
    priority,
    category,
    dueDate,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// createTicket — alta
// ═══════════════════════════════════════════════════════════════════════════

export async function createTicket(
  _prev: CreateTicketState,
  formData: FormData,
): Promise<CreateTicketState> {
  const parsed = parseTicketFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  // Si arranca ya resuelto/cerrado, seteamos resolved_at para satisfacer
  // el invariante. Raro pero válido (ticket cargado retroactivamente que
  // ya se resolvió).
  const resolvedAt = CLOSED_STATUSES.has(parsed.status)
    ? new Date().toISOString()
    : null;

  const supabase = await createSupabaseClient();
  const payload = {
    client_id: parsed.clientId,
    project_id: parsed.projectId,
    assignee_person_id: parsed.assigneePersonId,
    title: parsed.title,
    description: parsed.description,
    status: parsed.status,
    priority: parsed.priority,
    category: parsed.category,
    due_date: parsed.dueDate,
    resolved_at: resolvedAt,
  } as never;

  const { data, error } = await supabase
    .from("tickets")
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    // El trigger set_org_and_check_project raise con 23514 si project no
    // matchea el cliente. Traducimos a mensaje amable — el drawer filtra
    // projects por cliente así que el escenario es defensivo (form manipulado).
    if (error.code === "23514") {
      return {
        error:
          "El project seleccionado no pertenece al cliente. Cambiá el project o dejá el ticket sin project atado.",
      };
    }
    return { error: error.message };
  }

  const created = data as { id: string } | null;
  if (!created) return { error: "El insert no devolvió fila." };

  revalidatePath("/clientes/tickets");
  revalidatePath("/clientes");
  revalidatePath(`/clientes/${parsed.clientId}`);
  return { ok: true, ticketId: created.id };
}

// ═══════════════════════════════════════════════════════════════════════════
// updateTicket — edición.
//
// Lee el resolved_at actual para preservarlo cuando aplica.
// ═══════════════════════════════════════════════════════════════════════════

export async function updateTicket(
  ticketId: string,
  _prev: UpdateTicketState,
  formData: FormData,
): Promise<UpdateTicketState> {
  if (!ticketId) return { error: "Falta el id del ticket." };

  const parsed = parseTicketFormData(formData);
  if (typeof parsed === "string") return { error: parsed };

  const supabase = await createSupabaseClient();

  // Leo la fila actual para saber el resolved_at previo y client_id previo
  // (para revalidar la ficha vieja si el ticket se movió de cliente).
  const { data: existing, error: readErr } = await supabase
    .from("tickets")
    .select("resolved_at, client_id")
    .eq("id", ticketId)
    .maybeSingle();

  if (readErr) return { error: readErr.message };
  if (!existing) {
    return { error: "El ticket ya no existe o no tenés acceso." };
  }

  const prev = existing as {
    resolved_at: string | null;
    client_id: string;
  };

  const nextIsClosed = CLOSED_STATUSES.has(parsed.status);
  let resolvedAt: string | null;
  if (nextIsClosed) {
    // Cerrado nuevo → preservamos resolved_at previo si existía; sino now().
    resolvedAt = prev.resolved_at ?? new Date().toISOString();
  } else {
    // Abrimos el ticket → resolved_at siempre null.
    resolvedAt = null;
  }

  const payload = {
    client_id: parsed.clientId,
    project_id: parsed.projectId,
    assignee_person_id: parsed.assigneePersonId,
    title: parsed.title,
    description: parsed.description,
    status: parsed.status,
    priority: parsed.priority,
    category: parsed.category,
    due_date: parsed.dueDate,
    resolved_at: resolvedAt,
  } as never;

  const { error } = await supabase
    .from("tickets")
    .update(payload)
    .eq("id", ticketId);

  if (error) {
    if (error.code === "23514") {
      return {
        error:
          "El project seleccionado no pertenece al cliente. Cambiá el project o dejá el ticket sin project atado.",
      };
    }
    return { error: error.message };
  }

  revalidatePath("/clientes/tickets");
  revalidatePath("/clientes");
  revalidatePath(`/clientes/${parsed.clientId}`);
  if (prev.client_id !== parsed.clientId) {
    revalidatePath(`/clientes/${prev.client_id}`);
  }
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// deleteTicket — hard delete.
//
// Los tickets NO tienen dependientes en otras tablas. Si fue creado por
// error o quedó obsoleto, se borra con confirm client-side. El histórico
// de tickets resueltos/cerrados normalmente se mantiene por auditoría; el
// operador decide caso a caso.
// ═══════════════════════════════════════════════════════════════════════════

export async function deleteTicket(
  ticketId: string,
): Promise<DeleteTicketResult> {
  if (!ticketId) return { error: "Falta el id del ticket." };

  const supabase = await createSupabaseClient();

  // Leemos el client_id para revalidar la ficha del cliente.
  const { data: existing } = await supabase
    .from("tickets")
    .select("client_id")
    .eq("id", ticketId)
    .maybeSingle();
  const clientId = (existing as { client_id: string } | null)?.client_id;

  const { error } = await supabase
    .from("tickets")
    .delete()
    .eq("id", ticketId);
  if (error) return { error: error.message };

  revalidatePath("/clientes/tickets");
  revalidatePath("/clientes");
  if (clientId) revalidatePath(`/clientes/${clientId}`);
  return { ok: true };
}
