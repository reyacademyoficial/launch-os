"use client";

import { useRef, useState, useTransition } from "react";

import { postNotionComment } from "../../../configuracion/notion/actions";

export interface MentionableUser {
  readonly notionUserId: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Composer del comentario a Notion (4e).
//
// Textarea + chips de menciones + dropdown para agregar. El server prefija
// el content con "{KG name} escribió: " para preservar autoría humana en
// Notion (los comments creados por integration aparecen firmados por el
// bot, no por el usuario real).
//
// Solo se listan notion_users mapeados a organization_people (decisión de
// producto — 4e). El server también valida esa condición.
// ═══════════════════════════════════════════════════════════════════════════

export function NotionCommentComposer({
  projectId,
  mentionableUsers,
}: {
  readonly projectId: string;
  readonly mentionableUsers: readonly MentionableUser[];
}) {
  const [content, setContent] = useState("");
  const [mentions, setMentions] = useState<readonly MentionableUser[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [message, setMessage] = useState<
    { kind: "ok" | "error"; text: string } | null
  >(null);
  const [pending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function addMention(u: MentionableUser) {
    if (!mentions.some((m) => m.notionUserId === u.notionUserId)) {
      setMentions([...mentions, u]);
    }
    setPickerOpen(false);
    textareaRef.current?.focus();
  }

  function removeMention(id: string) {
    setMentions(mentions.filter((m) => m.notionUserId !== id));
  }

  function handleSubmit() {
    if (content.trim().length === 0 || pending) return;
    setMessage(null);
    const ids = mentions.map((m) => m.notionUserId);
    const currentContent = content;
    startTransition(async () => {
      const res = await postNotionComment(projectId, currentContent, ids);
      if (res.ok) {
        setContent("");
        setMentions([]);
        setMessage({ kind: "ok", text: "Comentario publicado en Notion." });
      } else {
        setMessage({ kind: "error", text: res.error });
      }
    });
  }

  const canSubmit = content.trim().length > 0 && !pending;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 12,
        borderRadius: "var(--kg-r-10)",
        border: "1px solid var(--kg-border-subtle)",
        background: "var(--kg-surface-1)",
      }}
    >
      <div
        className="kg-t7"
        style={{ color: "var(--kg-text-3)", fontWeight: 700 }}
      >
        Nuevo comentario
      </div>

      <textarea
        ref={textareaRef}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Escribí un comentario para la page de Notion…"
        rows={3}
        disabled={pending}
        style={{
          width: "100%",
          resize: "vertical",
          padding: "8px 10px",
          borderRadius: 8,
          border: "1px solid var(--kg-border-subtle)",
          background: "var(--kg-surface-2)",
          color: "var(--kg-text-1)",
          fontSize: 13,
          lineHeight: 1.5,
          fontFamily: "inherit",
          boxSizing: "border-box",
        }}
      />

      {mentions.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {mentions.map((m) => (
            <span
              key={m.notionUserId}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 4px 2px 8px",
                borderRadius: 999,
                background: "var(--kg-surface-2)",
                border: "1px solid var(--kg-border-subtle)",
                fontSize: 11,
                fontWeight: 600,
                color: "var(--kg-text-1)",
              }}
            >
              @{m.displayName}
              <button
                type="button"
                onClick={() => removeMention(m.notionUserId)}
                aria-label={`Quitar mención a ${m.displayName}`}
                disabled={pending}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "var(--kg-text-3)",
                  cursor: pending ? "default" : "pointer",
                  fontSize: 14,
                  lineHeight: 1,
                  padding: "0 4px",
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          position: "relative",
        }}
      >
        <div style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            disabled={pending || mentionableUsers.length === 0}
            style={{
              padding: "5px 10px",
              borderRadius: 999,
              border: "1px solid var(--kg-border-subtle)",
              background: "transparent",
              color: "var(--kg-text-2)",
              fontSize: 11,
              fontWeight: 700,
              cursor:
                pending || mentionableUsers.length === 0
                  ? "default"
                  : "pointer",
            }}
            title={
              mentionableUsers.length === 0
                ? "No hay usuarios de Notion mapeados a Personas de la organización."
                : "Mencionar a un usuario de Notion"
            }
          >
            @ Mencionar
          </button>
          {pickerOpen && mentionableUsers.length > 0 && (
            <div
              role="listbox"
              style={{
                position: "absolute",
                bottom: "calc(100% + 4px)",
                left: 0,
                zIndex: 30,
                minWidth: 220,
                maxHeight: 220,
                overflow: "auto",
                background: "var(--kg-surface-1)",
                border: "1px solid var(--kg-border-subtle)",
                borderRadius: 10,
                boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
                padding: 4,
              }}
            >
              {mentionableUsers.map((u) => {
                const already = mentions.some(
                  (m) => m.notionUserId === u.notionUserId,
                );
                return (
                  <button
                    key={u.notionUserId}
                    type="button"
                    onClick={() => addMention(u)}
                    disabled={already}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      width: "100%",
                      padding: "6px 8px",
                      borderRadius: 6,
                      border: "none",
                      background: "transparent",
                      color: already ? "var(--kg-text-3)" : "var(--kg-text-1)",
                      fontSize: 12,
                      textAlign: "left",
                      cursor: already ? "default" : "pointer",
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: "50%",
                        background: "var(--kg-surface-2)",
                        border: "1px solid var(--kg-border-subtle)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 11,
                        fontWeight: 700,
                        color: "var(--kg-text-2)",
                        overflow: "hidden",
                      }}
                    >
                      {u.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={u.avatarUrl}
                          alt=""
                          width={22}
                          height={22}
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                          }}
                        />
                      ) : (
                        (u.displayName.trim()[0] ?? "?").toUpperCase()
                      )}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      {u.displayName}
                    </span>
                    {already && (
                      <span style={{ fontSize: 10, color: "var(--kg-text-3)" }}>
                        agregado
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          style={{
            padding: "6px 14px",
            borderRadius: 999,
            border: "1px solid var(--kg-accent-500)",
            background: canSubmit ? "var(--kg-accent-500)" : "transparent",
            color: canSubmit ? "#fff" : "var(--kg-text-3)",
            fontSize: 11,
            fontWeight: 700,
            cursor: canSubmit ? "pointer" : "default",
          }}
        >
          {pending ? "Publicando…" : "Publicar en Notion"}
        </button>
      </div>

      {message && (
        <div
          role="status"
          style={{
            fontSize: 11,
            color:
              message.kind === "ok"
                ? "var(--kg-positive-500)"
                : "var(--kg-negative-500)",
          }}
        >
          {message.text}
        </div>
      )}
    </div>
  );
}
