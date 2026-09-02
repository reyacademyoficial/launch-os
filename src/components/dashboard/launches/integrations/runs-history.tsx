"use client";

import { useState } from "react";

import { KgDataTable, type Column } from "@/components/kg/data-table";
import { smallBtn } from "@/components/kg/form-primitives";
import { StatusPill } from "@/components/kg/status-pill";
import { TONE_VAR } from "@/components/kg/tone";
import { fmtDate } from "@/lib/format";
import type { RunHistoryEntry } from "@/lib/integrations/runs";

/**
 * Estado de una corrida → label + tono KG.
 *
 * Antes esto era `{ label, color }` con clases Tailwind viejas (`text-success`,
 * `text-error`…) aplicadas SOBRE el texto del estado. Ahora el color vive en
 * el dot del `StatusPill` y el texto queda neutro: es la regla del design
 * system y encima evita el efecto semáforo cuando la tabla lista 10 corridas
 * seguidas de estados distintos.
 */
const STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  running: { label: "Corriendo", tone: TONE_VAR.accent },
  success: { label: "OK", tone: TONE_VAR.positive },
  partial: { label: "Parcial", tone: TONE_VAR.warning },
  error: { label: "Error", tone: TONE_VAR.negative },
  token_invalid: { label: "Token inválido", tone: TONE_VAR.negative },
  rate_limited: { label: "Rate limit", tone: TONE_VAR.warning },
  config_missing: { label: "Falta config", tone: TONE_VAR.warning },
};

/**
 * Collapsible con las últimas N corridas.
 *
 * MIGRACIÓN KG
 * La `<table>` a mano (thead/tbody con `bg-surface`, `border-border`) pasó a
 * `KgDataTable`. Consecuencia de diseño a registrar: el detalle del error
 * antes se abría como una FILA extra debajo de la corrida (`<tr colSpan=4>`),
 * y `KgDataTable` no expone sub-filas. En vez de forzar el componente, el
 * detalle se movió a un bloque debajo de la tabla que muestra la corrida
 * expandida — se mantiene el toggle desde la celda de estado y no se pierde
 * ningún dato, solo cambia dónde aparece el JSON.
 */
export function RunsHistory({
  runs,
  filterProvider,
}: {
  readonly runs: readonly RunHistoryEntry[];
  readonly filterProvider?: string;
}) {
  const [open, setOpen] = useState(false);
  /** id de la corrida cuyo `errorDetail` está desplegado. null = ninguna. */
  const [detailId, setDetailId] = useState<string | null>(null);

  const filtered = filterProvider
    ? runs.filter((r) => r.provider === filterProvider)
    : runs;

  if (filtered.length === 0) return null;

  const detailRun = filtered.find((r) => r.id === detailId) ?? null;

  const columns: ReadonlyArray<Column<RunHistoryEntry>> = [
    {
      key: "startedAt",
      label: "Inicio",
      width: "150px",
      render: (run) => (
        <span
          className="kg-num"
          style={{ color: "var(--kg-text-3)", whiteSpace: "nowrap" }}
        >
          {new Date(run.startedAt).toLocaleString("es-AR", {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      ),
    },
    {
      key: "status",
      label: "Estado",
      width: "150px",
      render: (run) => {
        const status = STATUS_LABEL[run.status ?? ""] ?? {
          label: run.status ?? "—",
          tone: "var(--kg-neutral-500)",
        };
        const hasDetail =
          run.errorDetail !== null && run.errorDetail !== undefined;
        // Sin detalle no hay nada que abrir: se renderiza el pill pelado en
        // vez de un botón deshabilitado que igual invita al click.
        if (!hasDetail) {
          return <StatusPill text={status.label} tone={status.tone} />;
        }
        return (
          <button
            type="button"
            onClick={() =>
              setDetailId((prev) => (prev === run.id ? null : run.id))
            }
            aria-expanded={detailId === run.id}
            title="Ver detalle"
            className="kg-focus"
            style={{
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              textDecoration: "underline",
              textUnderlineOffset: 3,
            }}
          >
            <StatusPill text={status.label} tone={status.tone} />
          </button>
        );
      },
    },
    {
      key: "window",
      label: "Ventana",
      render: (run) => (
        <span style={{ color: "var(--kg-text-3)", whiteSpace: "nowrap" }}>
          {run.windowStart && run.windowEnd
            ? `${fmtDate(run.windowStart)} → ${fmtDate(run.windowEnd)}`
            : "—"}
        </span>
      ),
    },
    {
      key: "rowsWritten",
      label: "Filas",
      align: "right",
      numeric: true,
      width: "90px",
      render: (run) => run.rowsWritten ?? 0,
    },
  ];

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="kg-focus"
        style={smallBtn}
      >
        {open
          ? `Ocultar historial (${filtered.length})`
          : `Ver historial (${filtered.length})`}
      </button>

      {open && (
        <div style={{ marginTop: 10 }}>
          <KgDataTable
            columns={columns}
            rows={filtered}
            rowKey={(r) => r.id}
            emptyTitle="Sin corridas registradas"
          />

          {detailRun && (
            <div
              style={{
                marginTop: 10,
                borderRadius: "var(--kg-r-8)",
                border: "1px solid var(--kg-border-subtle)",
                background: "var(--kg-surface-2-solid)",
                padding: "10px 12px",
              }}
            >
              <div
                className="kg-t7"
                style={{ color: "var(--kg-text-3)", marginBottom: 6 }}
              >
                Detalle de la corrida del{" "}
                {new Date(detailRun.startedAt).toLocaleString("es-AR")}
              </div>
              <pre
                style={{
                  margin: 0,
                  overflowX: "auto",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  fontSize: 10.5,
                  lineHeight: 1.5,
                  color: "var(--kg-text-3)",
                }}
              >
                {JSON.stringify(detailRun.errorDetail, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
