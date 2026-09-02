import "server-only";

import { resolveCurrentOrganizationId } from "@/lib/organization/current";
import { requireSessionProfile } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Persistencia del chat financiero. Es el ÚNICO lugar que toca
 * `finance_ai_conversations` / `finance_ai_messages`.
 *
 * La RLS (0177) ya restringe todo a `can_edit_organization(org) AND
 * user_id = auth.uid()`, así que estas funciones no repiten el chequeo de
 * dueño: si el hilo no es tuyo, la query devuelve vacío. Lo que sí se hace
 * acá es resolver org + user para los INSERT, porque la policy los exige.
 */

export interface FinanceConversationRow {
  readonly id: string;
  readonly title: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export type FinanceMessageRole = "user" | "assistant";

export interface FinanceMessageRow {
  readonly id: string;
  readonly conversation_id: string;
  readonly role: FinanceMessageRole;
  readonly content: string;
  readonly model: string | null;
  readonly status: "ok" | "error";
  readonly created_at: string;
}

/** Hilos del usuario, más recientes primero por ACTIVIDAD (updated_at). */
export async function listFinanceConversations(
  limit = 50,
): Promise<FinanceConversationRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("finance_ai_conversations")
    .select("id, title, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as unknown as FinanceConversationRow[];
}

export async function getFinanceConversation(
  conversationId: string,
): Promise<FinanceConversationRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("finance_ai_conversations")
    .select("id, title, created_at, updated_at")
    .eq("id", conversationId)
    .maybeSingle();
  return (data ?? null) as unknown as FinanceConversationRow | null;
}

/** Hilo completo en orden cronológico — así se renderiza y así se manda al modelo. */
export async function listFinanceMessages(
  conversationId: string,
): Promise<FinanceMessageRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("finance_ai_messages")
    .select("id, conversation_id, role, content, model, status, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  return (data ?? []) as unknown as FinanceMessageRow[];
}

export async function createFinanceConversation(
  title: string,
): Promise<string | null> {
  const profile = await requireSessionProfile();
  const supabase = await createClient();
  const organizationId = await resolveCurrentOrganizationId(supabase);
  if (!organizationId) return null;

  const payload = {
    organization_id: organizationId,
    user_id: profile.id,
    title: title.trim() === "" ? "Nueva conversación" : title.trim(),
  } as never;
  const { data, error } = await supabase
    .from("finance_ai_conversations")
    .insert(payload)
    .select("id")
    .single();
  if (error) throw error;
  return (data as unknown as { id: string }).id;
}

export interface InsertMessageInput {
  readonly conversationId: string;
  readonly role: FinanceMessageRole;
  readonly content: string;
  readonly model?: string | null;
  readonly status?: "ok" | "error";
  readonly errorDetail?: Record<string, unknown> | null;
}

export async function insertFinanceMessage(
  input: InsertMessageInput,
): Promise<void> {
  const supabase = await createClient();
  const payload = {
    conversation_id: input.conversationId,
    role: input.role,
    content: input.content,
    model: input.model ?? null,
    status: input.status ?? "ok",
    error_detail: input.errorDetail ?? null,
  } as never;
  const { error } = await supabase.from("finance_ai_messages").insert(payload);
  if (error) throw error;
}

/**
 * Empuja `updated_at` para que el hilo suba en la lista. El trigger
 * `set_updated_at` (0177) lo escribe; el UPDATE solo tiene que existir, así
 * que escribimos el título contra sí mismo.
 */
export async function touchFinanceConversation(
  conversationId: string,
  title?: string,
): Promise<void> {
  const supabase = await createClient();
  const payload = (title != null
    ? { title }
    : { updated_at: new Date().toISOString() }) as never;
  await supabase
    .from("finance_ai_conversations")
    .update(payload)
    .eq("id", conversationId);
}

export async function deleteFinanceConversation(
  conversationId: string,
): Promise<void> {
  const supabase = await createClient();
  // Los mensajes caen por `on delete cascade` (0177).
  const { error } = await supabase
    .from("finance_ai_conversations")
    .delete()
    .eq("id", conversationId);
  if (error) throw error;
}

/**
 * Título automático a partir del primer mensaje. La primera línea, cortada
 * en palabra entera — un hilo llamado "Analizá mis gastos y decime cuál…"
 * se reconoce en la lista; "Nueva conversación #3" no.
 */
export function titleFromFirstMessage(text: string): string {
  const firstLine = text.trim().split("\n")[0]?.trim() ?? "";
  if (firstLine === "") return "Nueva conversación";
  if (firstLine.length <= 60) return firstLine;
  const cut = firstLine.slice(0, 60);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 30 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
