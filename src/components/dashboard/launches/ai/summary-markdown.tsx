"use client";

import ReactMarkdown from "react-markdown";

/**
 * Maps markdown nodes to design-system styled elements. Extraído del
 * AISummary original; lo reusan ahora la card de "Última corrida" y los
 * items expandidos del historial.
 *
 * Bumpeamos heading levels (h1/h2 → h3) porque la sección padre ya tiene
 * un h2 propio.
 */
export function SummaryMarkdown({ text }: { readonly text: string }) {
  return (
    <ReactMarkdown
      components={{
        h1: ({ children }) => (
          <h3 className="mb-3 mt-6 text-base font-bold text-fg first:mt-0">
            {children}
          </h3>
        ),
        h2: ({ children }) => (
          <h3 className="mb-3 mt-6 text-base font-bold text-fg first:mt-0">
            {children}
          </h3>
        ),
        h3: ({ children }) => (
          <h4 className="mb-2 mt-4 text-sm font-semibold text-fg first:mt-0">
            {children}
          </h4>
        ),
        p: ({ children }) => (
          <p className="mb-3 text-sm leading-relaxed text-fg-muted last:mb-0">
            {children}
          </p>
        ),
        ul: ({ children }) => (
          <ul className="mb-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-fg-muted last:mb-0 marker:text-fg-subtle">
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol className="mb-3 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-fg-muted last:mb-0 marker:font-semibold marker:text-accent">
            {children}
          </ol>
        ),
        li: ({ children }) => <li className="pl-1">{children}</li>,
        strong: ({ children }) => (
          <strong className="font-semibold text-fg">{children}</strong>
        ),
        em: ({ children }) => <em className="italic">{children}</em>,
        code: ({ children }) => (
          <code className="rounded bg-bg-elevated px-1.5 py-0.5 font-mono text-xs text-fg">
            {children}
          </code>
        ),
        hr: () => <hr className="my-4 border-border" />,
        a: ({ children, href }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            {children}
          </a>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
}
