"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";

/**
 * Modal de ayuda paso-a-paso para conectar un provider. Genérico — recibe
 * `title` + `markdown` como props, sin saber de qué provider se trata. La
 * página/servidor que lo invoca le pasa el .md leído por
 * `getInstructions(providerId)`.
 *
 * Reusable en Fase 3b para los demás providers sin cambios.
 */
export function InstructionsModal({
  triggerLabel = "¿Cómo conecto?",
  title,
  markdown,
}: {
  readonly triggerLabel?: string;
  readonly title: string;
  readonly markdown: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
      >
        <InfoIcon />
        <span>{triggerLabel}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="instructions-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 sm:p-6"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-md border border-border bg-bg-elevated shadow-card">
            <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
              <h3 id="instructions-title" className="text-lg font-bold text-fg">
                {title}
              </h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Cerrar"
                className="text-fg-subtle hover:text-fg"
              >
                ×
              </button>
            </header>
            <div className="prose-instructions flex-1 overflow-y-auto px-6 py-6 text-sm text-fg">
              <ReactMarkdown
                components={{
                  h1: ({ children }) => (
                    <h1 className="mb-4 text-xl font-bold text-fg">{children}</h1>
                  ),
                  h2: ({ children }) => (
                    <h2 className="mb-2 mt-6 text-base font-semibold text-fg">
                      {children}
                    </h2>
                  ),
                  h3: ({ children }) => (
                    <h3 className="mb-2 mt-4 text-sm font-semibold text-fg">
                      {children}
                    </h3>
                  ),
                  p: ({ children }) => (
                    <p className="mb-3 leading-relaxed text-fg-muted">{children}</p>
                  ),
                  ol: ({ children }) => (
                    <ol className="mb-3 ml-5 list-decimal space-y-1 text-fg-muted">
                      {children}
                    </ol>
                  ),
                  ul: ({ children }) => (
                    <ul className="mb-3 ml-5 list-disc space-y-1 text-fg-muted">
                      {children}
                    </ul>
                  ),
                  li: ({ children }) => <li className="text-fg-muted">{children}</li>,
                  code: ({ children }) => (
                    <code className="rounded bg-surface px-1.5 py-0.5 text-xs text-fg">
                      {children}
                    </code>
                  ),
                  blockquote: ({ children }) => (
                    <blockquote className="my-3 border-l-2 border-accent bg-surface/40 px-4 py-2 text-fg-muted">
                      {children}
                    </blockquote>
                  ),
                  a: ({ href, children }) => (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent underline hover:opacity-80"
                    >
                      {children}
                    </a>
                  ),
                  strong: ({ children }) => (
                    <strong className="font-semibold text-fg">{children}</strong>
                  ),
                  hr: () => <hr className="my-6 border-border" />,
                }}
              >
                {markdown}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function InfoIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}
