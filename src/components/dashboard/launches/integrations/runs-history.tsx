"use client";

import { useState } from "react";

import { fmtDate } from "@/lib/format";
import type { RunHistoryEntry } from "@/lib/integrations/runs";

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  running: { label: "Corriendo", color: "text-fg-muted" },
  success: { label: "OK", color: "text-success" },
  partial: { label: "Parcial", color: "text-warning" },
  error: { label: "Error", color: "text-error" },
  token_invalid: { label: "Token inválido", color: "text-error" },
  rate_limited: { label: "Rate limit", color: "text-warning" },
  config_missing: { label: "Falta config", color: "text-warning" },
};

/**
 * Collapsible con las últimas N corridas. Detalle del error se muestra
 * inline cuando existe.
 */
export function RunsHistory({
  runs,
  filterProvider,
}: {
  readonly runs: readonly RunHistoryEntry[];
  readonly filterProvider?: string;
}) {
  const [open, setOpen] = useState(false);

  const filtered = filterProvider
    ? runs.filter((r) => r.provider === filterProvider)
    : runs;

  if (filtered.length === 0) return null;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs font-medium text-accent hover:underline"
      >
        {open
          ? `Ocultar historial (${filtered.length})`
          : `Ver historial (${filtered.length})`}
      </button>

      {open && (
        <div className="mt-2 overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[480px] text-xs">
            <thead className="bg-surface text-left uppercase tracking-wide text-fg-subtle">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Inicio
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Estado
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Ventana
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Filas
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((run) => {
                const status = STATUS_LABEL[run.status ?? ""] ?? {
                  label: run.status ?? "—",
                  color: "text-fg-muted",
                };
                return (
                  <RunRow
                    key={run.id}
                    run={run}
                    statusLabel={status.label}
                    statusColor={status.color}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RunRow({
  run,
  statusLabel,
  statusColor,
}: {
  readonly run: RunHistoryEntry;
  readonly statusLabel: string;
  readonly statusColor: string;
}) {
  const [showDetail, setShowDetail] = useState(false);
  const hasDetail = run.errorDetail !== null && run.errorDetail !== undefined;

  return (
    <>
      <tr className="border-t border-border">
        <td className="whitespace-nowrap px-3 py-2 text-fg-muted">
          {new Date(run.startedAt).toLocaleString("es-AR", {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </td>
        <td className="px-3 py-2">
          <button
            type="button"
            onClick={() => hasDetail && setShowDetail((v) => !v)}
            disabled={!hasDetail}
            className={`font-medium ${statusColor} ${
              hasDetail ? "underline hover:opacity-80" : ""
            }`}
            title={hasDetail ? "Ver detalle" : undefined}
          >
            {statusLabel}
          </button>
        </td>
        <td className="px-3 py-2 text-fg-muted">
          {run.windowStart && run.windowEnd
            ? `${fmtDate(run.windowStart)} → ${fmtDate(run.windowEnd)}`
            : "—"}
        </td>
        <td className="px-3 py-2 text-right text-fg">{run.rowsWritten ?? 0}</td>
      </tr>
      {showDetail && hasDetail && (
        <tr className="border-t border-border bg-surface/30">
          <td colSpan={4} className="px-3 py-2">
            <pre className="overflow-x-auto whitespace-pre-wrap break-all text-[10px] text-fg-muted">
              {JSON.stringify(run.errorDetail, null, 2)}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
}
