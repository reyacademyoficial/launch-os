"use server";

import { revalidatePath } from "next/cache";

import { answerFinanceQuestion, DEFAULT_MODEL } from "@/lib/finance/ai/chat";
import {
  createFinanceConversation,
  deleteFinanceConversation,
  getFinanceConversation,
  insertFinanceMessage,
  listFinanceMessages,
  titleFromFirstMessage,
  touchFinanceConversation,
} from "@/lib/finance/ai/repo";
import { requireRole } from "@/lib/supabase/auth";

// ═══════════════════════════════════════════════════════════════════════════
// Contratos — discriminated unions, mismo patrón que el resto de Financiero
// ═══════════════════════════════════════════════════════════════════════════

export type SendMessageResult =
  | { readonly ok: true; readonly conversationId: string; readonly answer: string }
  | { readonly error: string; readonly conversationId: string | null };

export type DeleteConversationResult =
  | { readonly ok: true }
  | { readonly error: string };

export type RenameConversationResult =
  | { readonly ok: true }
  | { readonly error: string };

const MAX_MESSAGE_CHARS = 4000;

/**
 * Turno completo del chat: persiste la pregunta, arma el contexto con los
 * datos financieros reales, manda el HILO ENTERO al modelo y persiste la
 * respuesta.
 *
 * Orden deliberado: el mensaje del usuario se guarda ANTES de llamar al
 * proveedor. Si la API falla, la pregunta no se pierde y el hilo queda
 * consistente — el fallo se guarda como un `assistant` con status 'error'
 * (visible en la UI, invisible para el modelo en el próximo turno).
 *
 * Gate: superadmin/admin, igual que el resto del módulo. El layout ya
 * redirige, pero un server action se puede invocar sin pasar por él.
 */
export async function sendFinanceMessage(
  conversationId: string | null,
  text: string,
): Promise<SendMessageResult> {
  await requireRole("superadmin", "admin");

  const content = text.trim();
  if (content === "") {
    return { error: "Escribí una pregunta.", conversationId };
  }
  if (content.length > MAX_MESSAGE_CHARS) {
    return {
      error: `El mensaje es demasiado largo (${content.length} caracteres, máximo ${MAX_MESSAGE_CHARS}).`,
      conversationId,
    };
  }

  // ─── Resolver el hilo ────────────────────────────────────────────────
  let threadId: string;
  if (conversationId == null) {
    const created = await createFinanceConversation(
      titleFromFirstMessage(content),
    );
    if (created == null) {
      return {
        error:
          "No pude resolver tu organización. Verificá tus permisos sobre el módulo Financiero.",
        conversationId: null,
      };
    }
    threadId = created;
  } else {
    // La RLS ya filtra por dueño: si no aparece, o no existe o no es tuyo.
    const existing = await getFinanceConversation(conversationId);
    if (!existing) {
      return {
        error: "Esa conversación no existe (o no es tuya).",
        conversationId: null,
      };
    }
    threadId = existing.id;
  }

  await insertFinanceMessage({ conversationId: threadId, role: "user", content });

  // ─── Generar ─────────────────────────────────────────────────────────
  // Se releen los mensajes desde DB (en vez de armar el array en memoria)
  // para que el hilo que ve el modelo sea exactamente el que quedó
  // persistido, incluido el turno recién insertado.
  const history = await listFinanceMessages(threadId);

  try {
    const answer = await answerFinanceQuestion(history);
    await insertFinanceMessage({
      conversationId: threadId,
      role: "assistant",
      content: answer,
      model: DEFAULT_MODEL,
    });
    await touchFinanceConversation(threadId);
    revalidatePath("/financiero/ia");
    return { ok: true, conversationId: threadId, answer };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error inesperado";
    await insertFinanceMessage({
      conversationId: threadId,
      role: "assistant",
      content: `No pude responder: ${message}`,
      model: DEFAULT_MODEL,
      status: "error",
      errorDetail: { message },
    });
    await touchFinanceConversation(threadId);
    revalidatePath("/financiero/ia");
    return {
      error: `No pude generar la respuesta: ${message}`,
      conversationId: threadId,
    };
  }
}

export async function deleteConversation(
  conversationId: string,
): Promise<DeleteConversationResult> {
  await requireRole("superadmin", "admin");
  try {
    await deleteFinanceConversation(conversationId);
    revalidatePath("/financiero/ia");
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error inesperado";
    return { error: `No pude borrar la conversación: ${message}` };
  }
}

export async function renameConversation(
  conversationId: string,
  title: string,
): Promise<RenameConversationResult> {
  await requireRole("superadmin", "admin");
  const clean = title.trim().slice(0, 120);
  if (clean === "") return { error: "El título no puede quedar vacío." };
  try {
    await touchFinanceConversation(conversationId, clean);
    revalidatePath("/financiero/ia");
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error inesperado";
    return { error: `No pude renombrar la conversación: ${message}` };
  }
}
