"use client";

import { useState } from "react";

import type { AiRunRow } from "@/lib/ai/types";

import { SummaryMarkdown } from "./summary-markdown";

/**
 * Lista de corridas de IA, más reciente primero. Cada item es colapsable —
 * el output completo se ve cuando expandís. Default: el más reciente abierto.
 * Status='error' muestra el mensaje de error en lugar del output.
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
      <p className="rounded-md border border-dashed border-border bg-surface/40 p-6 text-center text-sm text-fg-muted">
        Sin corridas anteriores. La primera que generes va a aparecer acá.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {runs.map((run, idx) => (
        <RunItem
          key={run.id}
          run={run}
          authorName={run.user_id ? authorById.get(run.user_id) ?? "Usuario" : "Sistema"}
          defaultOpen={idx === 0}
        />
      ))}
    </ul>
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
    <li className="overflow-hidden rounded-md border border-border bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-bg-elevated"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-medium text-fg">
            <span>{authorName}</span>
            {isError && (
              <span className="rounded bg-error/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-error">
                Error
              </span>
            )}
          </div>
          <div className="mt-0.5 text-xs text-fg-subtle">
            {formatRelativeDate(run.created_at)}
            <span className="mx-2">·</span>
            {run.model}
          </div>
        </div>
        <span
          aria-hidden
          className={
            "text-fg-subtle transition-transform " + (open ? "rotate-180" : "")
          }
        >
          ▾
        </span>
      </button>
      {open && (
        <div className="border-t border-border bg-bg-elevated/50 px-6 py-5">
          {isError ? (
            <p className="text-sm text-error">{errorMessage}</p>
          ) : run.output_text ? (
            <SummaryMarkdown text={run.output_text} />
          ) : (
            <p className="text-sm text-fg-muted">Sin contenido.</p>
          )}
        </div>
      )}
    </li>
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
