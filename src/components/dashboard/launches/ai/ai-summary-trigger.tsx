"use client";

import { useState, useTransition } from "react";

import { generateLaunchSummary } from "@/app/(app)/(kg)/proyectos/[projectId]/launches/[launchId]/ai-actions";
import {
  ErrorBanner,
  primaryBtn,
  secondaryBtn,
} from "@/components/kg/form-primitives";
import { Panel } from "@/components/kg/panel";
import { StateDot } from "@/components/kg/state-dot";

import { SummaryMarkdown } from "./summary-markdown";

/**
 * Trigger para generar un nuevo análisis. Después del éxito, el server
 * action revalida la ruta /ia y el historial debajo aparece con la nueva
 * corrida. El output también se muestra en una card "Última generación"
 * para feedback inmediato sin scroll.
 *
 * MIGRACIÓN KG
 * La card `border-accent/40 bg-accent/5` pasó a `Panel` (una sola superficie
 * en todo el módulo) y el `Button` de `components/ui` a `primaryBtn` /
 * `secondaryBtn`. El pending deja de ser sólo un cambio de label: lleva
 * `StateDot` de acento adelante, como `sync-button.tsx`.
 *
 * El error, que era un `<p role="alert">` con `border-error/40 bg-error/10`,
 * es ahora `ErrorBanner` — misma semántica de `role="alert"`, pero el estilo
 * sale de la primitiva.
 */
export function AiSummaryTrigger({
  projectId,
  launchId,
  canRun,
  hasHistory,
}: {
  readonly projectId: string;
  readonly launchId: string;
  /** Solo admin/operador pueden disparar. Coordinador/cliente leen el historial. */
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
      <p className="kg-t7" style={{ color: "var(--kg-text-3)", margin: 0 }}>
        Sin permisos para generar nuevos análisis. Mirá el historial debajo.
      </p>
    );
  }

  // Cuando ya hay historial (o una generación en esta sesión), generar de
  // nuevo es una acción secundaria: lo primario pasa a ser leer lo que hay.
  const isRepeat = summary !== null || hasHistory;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Panel
        title="Generar análisis"
        actions={
          <button
            type="button"
            onClick={run}
            disabled={pending}
            className="kg-focus"
            style={{
              ...(isRepeat ? secondaryBtn : primaryBtn),
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              whiteSpace: "nowrap",
              opacity: pending ? 0.5 : 1,
              cursor: pending ? "not-allowed" : "pointer",
            }}
          >
            {pending && <StateDot tone="accent" />}
            {pending ? "Generando…" : isRepeat ? "Generar de nuevo" : "Generar"}
          </button>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p className="kg-t6" style={{ color: "var(--kg-text-3)", margin: 0 }}>
            La IA analiza los KPIs y los datos diarios cargados. Cada generación
            queda en el historial debajo.
          </p>
          {error && <ErrorBanner message={error} />}
        </div>
      </Panel>

      {summary && (
        <Panel title="Última generación">
          <SummaryMarkdown text={summary} />
        </Panel>
      )}
    </div>
  );
}
