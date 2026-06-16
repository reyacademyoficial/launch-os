"use client";

import { useState, useTransition } from "react";

import { generateClientLaunchSummary } from "@/app/(cliente)/portal/proyectos/[projectId]/launches/[launchId]/ia/actions";
import { SummaryMarkdown } from "@/components/dashboard/launches/ai/summary-markdown";
import { Button } from "@/components/ui/button";

/**
 * Variante del AiSummaryTrigger del equipo, dedicada al portal del cliente.
 * Llama al server action propio (`generateClientLaunchSummary`) en vez del
 * del equipo. La UI es deliberadamente igual — el usuario clickea, ve
 * pendiente, ve el output.
 */
export function ClientAiTrigger({
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
      const result = await generateClientLaunchSummary(projectId, launchId);
      if ("error" in result) setError(result.error);
      else setSummary(result.text);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-fg-subtle">
          La IA analiza los KPIs y los datos diarios del lanzamiento.
        </p>
        <Button
          type="button"
          variant={summary ? "secondary" : "primary"}
          onClick={run}
          disabled={pending}
        >
          {pending ? "Generando…" : summary ? "Generar de nuevo" : "Generar"}
        </Button>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-error/40 bg-error/10 p-3 text-sm text-error"
        >
          {error}
        </p>
      )}

      {summary && (
        <article className="rounded-md border border-accent/40 bg-accent/5 p-6">
          <div className="mb-3 text-xs uppercase tracking-wide text-accent">
            Análisis
          </div>
          <SummaryMarkdown text={summary} />
        </article>
      )}
    </div>
  );
}
