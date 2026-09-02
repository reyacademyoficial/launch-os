import type { Metadata } from "next";

import { ContextBar } from "@/components/kg/context-bar";
import { IconFin } from "@/components/kg/icons";
import { fCount } from "@/lib/finance/format";
import {
  getFinanceConversation,
  listFinanceConversations,
  listFinanceMessages,
} from "@/lib/finance/ai/repo";

import { ChatView, type ChatMessage, type ConversationItem } from "./chat-view";

export const metadata: Metadata = { title: "Analista IA · Financiero" };

/**
 * Chat financiero. El hilo activo se elige por query param `?c=` — así el
 * link a una conversación es compartible, el back del browser funciona, y
 * el server component puede traer los mensajes sin estado en el cliente.
 *
 * Sin `?c=` la pantalla arranca vacía: el hilo se crea recién cuando el
 * usuario manda la primera pregunta (no queremos conversaciones fantasma en
 * la lista por cada vez que alguien entra a la pestaña).
 */
export default async function FinancieroIaPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const requestedId = typeof sp.c === "string" ? sp.c : null;

  const conversations = await listFinanceConversations(50);

  // Validamos el id pedido contra la RLS antes de traer mensajes: un `?c=`
  // ajeno o borrado cae a "conversación nueva" en vez de romper la página.
  const active = requestedId ? await getFinanceConversation(requestedId) : null;
  const messages = active ? await listFinanceMessages(active.id) : [];

  const conversationItems: ConversationItem[] = conversations.map((c) => ({
    id: c.id,
    title: c.title,
    updatedAt: c.updated_at,
  }));
  const chatMessages: ChatMessage[] = messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    status: m.status,
    createdAt: m.created_at,
  }));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <ContextBar
        icon={<IconFin size={16} />}
        title="Analista IA"
        stats={[
          { l: "Conversaciones", v: fCount(conversations.length) },
          {
            l: "Hilo activo",
            v: active ? `${chatMessages.length} mensajes` : "nuevo",
          },
          { l: "Datos", v: "últimos 12 meses" },
        ]}
      />

      <ChatView
        conversations={conversationItems}
        activeConversationId={active?.id ?? null}
        messages={chatMessages}
      />
    </div>
  );
}
