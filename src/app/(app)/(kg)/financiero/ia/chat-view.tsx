"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { SummaryMarkdown } from "@/components/dashboard/launches/ai/summary-markdown";
import { EmptyState } from "@/components/kg/empty-state";
import { IconFin } from "@/components/kg/icons";
import { Panel } from "@/components/kg/panel";

import { deleteConversation, sendFinanceMessage } from "./actions";

export interface ConversationItem {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: string;
}

export interface ChatMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly status: "ok" | "error";
  readonly createdAt: string;
}

/** Arranques sugeridos: la pantalla vacía tiene que enseñar qué se puede preguntar. */
const SUGGESTIONS: readonly string[] = [
  "Analizá mis gastos y decime cuáles son excesos que debería sacar.",
  "¿Qué gastos recurrentes puedo cortar sin frenar la operación?",
  "¿Cómo viene el margen neto de los últimos 3 meses y qué lo explica?",
  "¿Cuánto runway tengo y cuál es el recorte que más lo estira?",
];

export function ChatView({
  conversations,
  activeConversationId,
  messages,
}: {
  readonly conversations: readonly ConversationItem[];
  readonly activeConversationId: string | null;
  readonly messages: readonly ChatMessage[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // El mensaje optimista vive solo hasta que el server devuelve el hilo con
  // la fila real. Se descarta ajustando estado DURANTE el render (patrón
  // "adjusting state when a prop changes") en vez de en un efecto: así no
  // hay un frame intermedio donde la pregunta aparezca duplicada — una vez
  // como optimista y otra como fila persistida.
  const [syncedThread, setSyncedThread] = useState({
    length: messages.length,
    id: activeConversationId,
  });
  if (
    syncedThread.length !== messages.length ||
    syncedThread.id !== activeConversationId
  ) {
    setSyncedThread({ length: messages.length, id: activeConversationId });
    setPendingQuestion(null);
  }

  function submit(text: string) {
    const question = text.trim();
    if (question === "" || isPending) return;

    setDraft("");
    setError(null);
    setPendingQuestion(question);

    startTransition(async () => {
      const result = await sendFinanceMessage(activeConversationId, question);

      if ("error" in result) {
        // Si el hilo se creó igual, el error quedó persistido como turno del
        // asistente: refrescamos y lo mostramos en la conversación. Si no
        // hubo hilo (validación / permisos), va al banner.
        setDraft(question);
        setPendingQuestion(null);
        if (result.conversationId == null) {
          setError(result.error);
        } else if (result.conversationId !== activeConversationId) {
          router.replace(`/financiero/ia?c=${result.conversationId}`);
        } else {
          router.refresh();
        }
        return;
      }

      if (result.conversationId !== activeConversationId) {
        router.replace(`/financiero/ia?c=${result.conversationId}`);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row"
      style={{ alignItems: "stretch" }}
    >
      <ConversationSidebar
        conversations={conversations}
        activeConversationId={activeConversationId}
      />

      <div className="flex min-h-0 flex-1 flex-col">
        <Panel fillHeight pad={false}>
          <div className="flex min-h-0 flex-1 flex-col">
            <Thread
              messages={messages}
              pendingQuestion={pendingQuestion}
              isPending={isPending}
              onPickSuggestion={submit}
            />
            <Composer
              draft={draft}
              setDraft={setDraft}
              onSubmit={() => submit(draft)}
              isPending={isPending}
              error={error}
            />
          </div>
        </Panel>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Sidebar de conversaciones
// ═══════════════════════════════════════════════════════════════════════════

function ConversationSidebar({
  conversations,
  activeConversationId,
}: {
  readonly conversations: readonly ConversationItem[];
  readonly activeConversationId: string | null;
}) {
  const router = useRouter();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function remove(id: string) {
    startTransition(async () => {
      await deleteConversation(id);
      setConfirmingId(null);
      // Si borré el hilo abierto, vuelvo a la pantalla de conversación nueva.
      if (id === activeConversationId) router.replace("/financiero/ia");
      else router.refresh();
    });
  }

  return (
    <aside className="flex w-full flex-col lg:w-[280px] lg:shrink-0">
      <Panel fillHeight pad={false}>
        <div className="flex min-h-0 flex-1 flex-col">
          <div style={{ padding: 12, borderBottom: "1px solid var(--kg-border-subtle)" }}>
            <Link
              href="/financiero/ia"
              className="kg-t5"
              style={{
                display: "block",
                textAlign: "center",
                padding: "9px 12px",
                borderRadius: "var(--kg-r-12)",
                border: "1px solid var(--kg-border-accent)",
                background: "var(--kg-accent-halo)",
                color: "var(--kg-accent-text)",
                textDecoration: "none",
              }}
            >
              + Nueva conversación
            </Link>
          </div>

          <div
            className="min-h-0 flex-1 overflow-y-auto"
            style={{ padding: 8, maxHeight: 420 }}
          >
            {conversations.length === 0 ? (
              <p
                className="kg-t6"
                style={{ color: "var(--kg-text-3)", padding: "12px 8px" }}
              >
                Todavía no tenés conversaciones. La primera pregunta crea el
                hilo.
              </p>
            ) : (
              conversations.map((c) => {
                const isActive = c.id === activeConversationId;
                return (
                  <div
                    key={c.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      borderRadius: "var(--kg-r-12)",
                      background: isActive ? "var(--kg-surface-2)" : undefined,
                      border: `1px solid ${isActive ? "var(--kg-border-default)" : "transparent"}`,
                      marginBottom: 2,
                    }}
                  >
                    <Link
                      href={`/financiero/ia?c=${c.id}`}
                      className="kg-t6"
                      style={{
                        flex: 1,
                        minWidth: 0,
                        padding: "9px 10px",
                        color: isActive
                          ? "var(--kg-text-1)"
                          : "var(--kg-text-2)",
                        textDecoration: "none",
                      }}
                    >
                      <span
                        style={{
                          display: "block",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {c.title}
                      </span>
                      <span
                        style={{ color: "var(--kg-text-3)", fontSize: 10.5 }}
                      >
                        {formatRelative(c.updatedAt)}
                      </span>
                    </Link>

                    {confirmingId === c.id ? (
                      <button
                        type="button"
                        onClick={() => remove(c.id)}
                        disabled={isPending}
                        className="kg-t7"
                        style={{
                          padding: "4px 8px",
                          marginRight: 6,
                          borderRadius: "var(--kg-r-8)",
                          border: "1px solid var(--kg-border-accent)",
                          background: "var(--kg-accent-halo)",
                          color: "var(--kg-accent-text)",
                          cursor: "pointer",
                        }}
                      >
                        {isPending ? "…" : "Confirmar"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmingId(c.id)}
                        aria-label={`Borrar conversación ${c.title}`}
                        style={{
                          padding: "4px 8px",
                          marginRight: 6,
                          background: "none",
                          border: "none",
                          color: "var(--kg-text-3)",
                          cursor: "pointer",
                          fontSize: 14,
                          lineHeight: 1,
                        }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </Panel>
    </aside>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Hilo de mensajes
// ═══════════════════════════════════════════════════════════════════════════

function Thread({
  messages,
  pendingQuestion,
  isPending,
  onPickSuggestion,
}: {
  readonly messages: readonly ChatMessage[];
  readonly pendingQuestion: string | null;
  readonly isPending: boolean;
  readonly onPickSuggestion: (text: string) => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Anclar abajo en cada turno nuevo: en un chat, lo último es lo que importa.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, pendingQuestion, isPending]);

  const isEmpty = messages.length === 0 && pendingQuestion == null;

  if (isEmpty) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto" style={{ padding: 20 }}>
        <EmptyState
          icon={<IconFin size={20} />}
          title="Preguntale a la IA sobre tus finanzas"
          hint="Lee tus gastos, nómina, facturas, bancos y liquidaciones de los últimos 12 meses. Recuerda la conversación, así que podés repreguntar sobre lo que te responda."
        />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            maxWidth: 560,
            margin: "0 auto",
          }}
        >
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onPickSuggestion(s)}
              className="kg-t6"
              style={{
                textAlign: "left",
                padding: "10px 14px",
                borderRadius: "var(--kg-r-12)",
                border: "1px solid var(--kg-border-subtle)",
                background: "var(--kg-surface-2)",
                color: "var(--kg-text-2)",
                cursor: "pointer",
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto"
      style={{ padding: "20px 20px 8px", display: "flex", flexDirection: "column", gap: 14 }}
    >
      {messages.map((m) => (
        <MessageBubble key={m.id} message={m} />
      ))}

      {pendingQuestion != null && (
        <MessageBubble
          message={{
            id: "pending",
            role: "user",
            content: pendingQuestion,
            status: "ok",
            createdAt: new Date().toISOString(),
          }}
        />
      )}

      {isPending && (
        <div
          className="kg-t6"
          style={{
            alignSelf: "flex-start",
            padding: "10px 14px",
            borderRadius: "var(--kg-r-16)",
            border: "1px solid var(--kg-border-subtle)",
            background: "var(--kg-surface-2)",
            color: "var(--kg-text-3)",
          }}
        >
          Analizando tus números…
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}

function MessageBubble({ message }: { readonly message: ChatMessage }) {
  const isUser = message.role === "user";
  const isError = message.status === "error";

  return (
    <div
      style={{
        alignSelf: isUser ? "flex-end" : "flex-start",
        maxWidth: isUser ? "80%" : "100%",
        width: isUser ? undefined : "100%",
        padding: isUser ? "10px 14px" : "14px 16px",
        borderRadius: "var(--kg-r-16)",
        border: `1px solid ${
          isError ? "var(--kg-border-accent)" : "var(--kg-border-subtle)"
        }`,
        background: isUser
          ? "var(--kg-accent-halo)"
          : isError
            ? "var(--kg-accent-halo)"
            : "var(--kg-surface-2)",
        color: "var(--kg-text-1)",
      }}
    >
      {isUser ? (
        <p className="kg-t6" style={{ margin: 0, whiteSpace: "pre-wrap" }}>
          {message.content}
        </p>
      ) : isError ? (
        <p
          role="alert"
          className="kg-t6"
          style={{ margin: 0, color: "var(--kg-accent-text)" }}
        >
          {message.content}
        </p>
      ) : (
        <SummaryMarkdown text={message.content} />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Composer
// ═══════════════════════════════════════════════════════════════════════════

function Composer({
  draft,
  setDraft,
  onSubmit,
  isPending,
  error,
}: {
  readonly draft: string;
  readonly setDraft: (v: string) => void;
  readonly onSubmit: () => void;
  readonly isPending: boolean;
  readonly error: string | null;
}) {
  return (
    <div
      style={{
        borderTop: "1px solid var(--kg-border-subtle)",
        padding: 14,
        flexShrink: 0,
      }}
    >
      {error && (
        <p
          role="alert"
          className="kg-t6"
          style={{
            margin: "0 0 10px",
            padding: "8px 12px",
            borderRadius: "var(--kg-r-12)",
            border: "1px solid var(--kg-border-accent)",
            background: "var(--kg-accent-halo)",
            color: "var(--kg-accent-text)",
          }}
        >
          {error}
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        style={{ display: "flex", gap: 10, alignItems: "flex-end" }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter manda, Shift+Enter hace salto de línea: convención de chat.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSubmit();
            }
          }}
          rows={2}
          placeholder="Preguntá sobre tus gastos, márgenes, runway…"
          disabled={isPending}
          className="kg-t6"
          style={{
            flex: 1,
            resize: "none",
            padding: "10px 14px",
            borderRadius: "var(--kg-r-12)",
            border: "1px solid var(--kg-border-default)",
            background: "var(--kg-surface-1-solid)",
            color: "var(--kg-text-1)",
            fontFamily: "inherit",
          }}
        />
        <button
          type="submit"
          disabled={isPending || draft.trim() === ""}
          className="kg-t5"
          style={{
            padding: "11px 20px",
            borderRadius: "var(--kg-r-12)",
            border: "1px solid var(--kg-border-accent)",
            background: "var(--kg-accent-halo)",
            color: "var(--kg-accent-text)",
            cursor: isPending || draft.trim() === "" ? "not-allowed" : "pointer",
            opacity: isPending || draft.trim() === "" ? 0.5 : 1,
            whiteSpace: "nowrap",
          }}
        >
          {isPending ? "Pensando…" : "Enviar"}
        </button>
      </form>
    </div>
  );
}

/** "hace 5 min" / "ayer" / "12 mar" — contexto suficiente para la lista. */
function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diffMin = Math.round((Date.now() - then) / 60000);
  if (diffMin < 1) return "recién";
  if (diffMin < 60) return `hace ${diffMin} min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `hace ${diffH} h`;
  if (diffH < 48) return "ayer";
  return new Date(iso).toLocaleDateString("es-AR", {
    day: "numeric",
    month: "short",
  });
}
