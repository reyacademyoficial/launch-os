"use client";

import { useState } from "react";

import { EmptyState } from "@/components/kg/empty-state";
import { smallBtn } from "@/components/kg/form-primitives";
import { Panel } from "@/components/kg/panel";
import { StatRow } from "@/components/kg/stat-row";
import { StatusPill } from "@/components/kg/status-pill";
import { TONE_VAR } from "@/components/kg/tone";
import type { AiRunRow } from "@/lib/ai/types";

import { SummaryMarkdown } from "./summary-markdown";

/**
 * Lista de corridas de IA, más reciente primero. Cada item es colapsable —
 * el output completo se ve cuando expandís. Default: el más reciente abierto.
 * Status='error' muestra el mensaje de error en lugar del output.
 *
 * MIGRACIÓN KG
 * El `<ul>` de `<li>` con superficie propia (`rounded-md border-border
 * bg-surface`) pasa a un `Panel` por corrida: el autor y el estado viven en
 * el header del Panel y los metadatos (fecha + modelo) en un `StatRow`, que
 * es justo la jerarquía-3 del design system.
 *
 * QUÉ NO SE MIGRÓ, Y POR QUÉ: `Breakdown`. Es un total que se abre en partes
 * con barras proporcionales — necesita un número y sus componentes. Una
 * corrida de IA no expone ninguna magnitud descomponible (no persistimos
 * tokens ni costo en `ai_runs`), así que meterla acá sería inventar datos.
 * Si en algún momento el run guarda tokens de prompt/completion, ese es el
 * lugar natural para `Breakdown`.
 */
export function AiHistory({
  runs,
  authorById,
}: {
  readonly runs: ReadonlyArray<AiRunRow>;
  readonly authorById: ReadonlyMap<string, string>;
}) {
  if (runs.length === 0) {
    return (
      <Panel pad={false}>
        <EmptyState
          title="Sin corridas anteriores"
          hint="La primera que generes va a aparecer acá, con su output completo."
        />
      </Panel>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {runs.map((run, idx) => (
        <RunItem
          key={run.id}
          run={run}
          authorName={run.user_id ? authorById.get(run.user_id) ?? "Usuario" : "Sistema"}
          defaultOpen={idx === 0}
        />
      ))}
    </div>
  );
}

function RunItem({
  run,
  authorName,
  defaultOpen,
}: {
  readonly run: AiRunRow;
  readonly authorName: string;
  readonly defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const isError = run.status === "error";
  const errorMessage =
    isError && typeof run.error_detail === "object" && run.error_detail !== null
      ? (run.error_detail as { message?: string }).message ?? "Error sin detalle"
      : null;

  return (
    <Panel
      title={
        <span
          style={{ display: "inline-flex", alignItems: "center", gap: 10 }}
        >
          {authorName}
          <StatusPill
            text={isError ? "Error" : "OK"}
            tone={isError ? TONE_VAR.negative : TONE_VAR.positive}
          />
        </span>
      }
      actions={
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="kg-focus"
          style={{ ...smallBtn, whiteSpace: "nowrap" }}
        >
          {open ? "Ocultar" : "Ver"}
        </button>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <StatRow
          items={[
            { l: "Fecha", v: formatRelativeDate(run.created_at) },
            { l: "Modelo", v: run.model },
          ]}
        />

        {open &&
          (isError ? (
            // El detalle del error se lee como contenido, no como alerta de
            // formulario: la corrida ya está marcada con el StatusPill del
            // header y duplicar el tono rojo en un banner sería redundante.
            <p
              className="kg-t6"
              style={{ color: "var(--kg-text-2)", margin: 0 }}
            >
              {errorMessage}
            </p>
          ) : run.output_text ? (
            <SummaryMarkdown text={run.output_text} />
          ) : (
            <p
              className="kg-t6"
              style={{ color: "var(--kg-text-3)", margin: 0 }}
            >
              Sin contenido.
            </p>
          ))}
      </div>
    </Panel>
  );
}

function formatRelativeDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("es-AR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
