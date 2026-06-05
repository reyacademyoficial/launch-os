"use client";

import { useState, useTransition } from "react";
import ReactMarkdown from "react-markdown";

import { generateLaunchSummary } from "@/app/(app)/proyectos/[projectId]/launches/[launchId]/ai-actions";
import { Button } from "@/components/ui/button";

export function AISummary({
  projectId,
  launchId,
}: {
  readonly projectId: string;
  readonly launchId: string;
}) {
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    setError(null);
    startTransition(async () => {
      const result = await generateLaunchSummary(projectId, launchId);
      if ("error" in result) setError(result.error);
      else setSummary(result.text);
    });
  }

  return (
    <section className="space-y-4">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-fg">Resumen ejecutivo</h2>
          <p className="text-xs text-fg-subtle">
            Generado por OpenAI a partir de los KPIs y los datos diarios cargados.
          </p>
        </div>
        <Button
          type="button"
          variant={summary ? "secondary" : "primary"}
          onClick={run}
          disabled={pending}
        >
          {pending ? "Generando…" : summary ? "Regenerar" : "Generar"}
        </Button>
      </header>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-error/40 bg-error/10 p-3 text-sm text-error"
        >
          {error}
        </p>
      )}

      {summary && (
        <article className="rounded-md border border-border bg-surface p-6">
          <SummaryMarkdown text={summary} />
        </article>
      )}

      {!summary && !error && !pending && (
        <p className="rounded-md border border-dashed border-border bg-surface/40 p-6 text-center text-sm text-fg-muted">
          Click <strong className="text-fg">&ldquo;Generar&rdquo;</strong> para que
          la IA analice este lanzamiento.
        </p>
      )}
    </section>
  );
}

/**
 * Maps markdown nodes to design-system styled elements. We bump heading
 * levels by one (`## ` in the model output → `<h3>`) because the section
 * already has an `<h2>Resumen ejecutivo</h2>` above.
 */
function SummaryMarkdown({ text }: { readonly text: string }) {
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
