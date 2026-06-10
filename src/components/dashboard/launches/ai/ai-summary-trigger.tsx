"use client";

import { useState, useTransition } from "react";

import { generateLaunchSummary } from "@/app/(app)/proyectos/[projectId]/launches/[launchId]/ai-actions";
import { Button } from "@/components/ui/button";

import { SummaryMarkdown } from "./summary-markdown";

/**
 * Trigger para generar un nuevo análisis. Después del éxito, el server
 * action revalida la ruta /ia y el historial debajo aparece con la nueva
 * corrida. El output también se muestra en una card "Última generación"
 * para feedback inmediato sin scroll.
 */
export function AiSummaryTrigger({
  projectId,
  launchId,
  canRun,
  hasHistory,
}: {
  readonly projectId: string;
  readonly launchId: string;
  /** Solo admin/operador pueden disparar. Analista/cliente leen el historial. */
  readonly canRun: boolean;
  readonly hasHistory: boolean;
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

  if (!canRun) {
    return (
      <p className="text-xs text-fg-subtle">
        Sin permisos para generar nuevos análisis. Mirá el historial debajo.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-fg-subtle">
          La IA analiza los KPIs y los datos diarios cargados. Cada generación
          queda en el historial debajo.
        </p>
        <Button
          type="button"
          variant={summary || hasHistory ? "secondary" : "primary"}
          onClick={run}
          disabled={pending}
        >
          {pending
            ? "Generando…"
            : summary || hasHistory
              ? "Generar de nuevo"
              : "Generar"}
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
            Última generación
          </div>
          <SummaryMarkdown text={summary} />
        </article>
      )}
    </div>
  );
}
