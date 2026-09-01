"use client";

import { useState } from "react";

import type { SaleExportRow } from "@/lib/launch-sales/export-types";

/**
 * Botón "Exportar a Excel" de la tabla de Ventas project-wide.
 *
 * Los filtros de esta tabla viven en React state, así que no alcanza con un
 * `<a href>` al route handler como en leads (ahí viajan por la URL). Acá el
 * botón arma las filas visibles en el momento del click (`getRows`, lazy —
 * no queremos recalcularlas en cada render) y las POSTea; el server responde
 * el xlsx, que bajamos vía object URL.
 */
export function ExportSalesButton({
  projectId,
  getRows,
  getFilterSummary,
  hideCommission = false,
  disabled = false,
}: {
  readonly projectId: string;
  readonly getRows: () => SaleExportRow[];
  /** Descripción legible de los filtros activos, para la hoja "Resumen". */
  readonly getFilterSummary: () => string[];
  readonly hideCommission?: boolean;
  readonly disabled?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setError(null);
    setPending(true);
    try {
      const res = await fetch(`/api/proyectos/${projectId}/ventas/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: getRows(),
          meta: { filters: getFilterSummary(), hideCommission },
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          (body as { error?: string } | null)?.error ??
            `No se pudo generar el archivo (${res.status})`,
        );
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filenameFrom(res.headers.get("Content-Disposition"));
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revocamos en el próximo tick: revocar sincrónicamente cancela la
      // descarga en algunos navegadores.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al exportar");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {error && (
        <span role="alert" className="text-xs text-error">
          {error}
        </span>
      )}
      <button
        type="button"
        onClick={onClick}
        disabled={pending || disabled}
        title={
          disabled
            ? "No hay ventas para exportar"
            : "Descarga las ventas visibles (respeta los filtros aplicados)"
        }
        className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-3 py-2 text-sm font-semibold text-fg hover:bg-bg-elevated disabled:opacity-50"
      >
        ⬇ {pending ? "Generando…" : "Exportar a Excel"}
      </button>
    </div>
  );
}

/** Lee el filename del Content-Disposition; fallback con la fecha de hoy. */
function filenameFrom(disposition: string | null): string {
  const match = disposition?.match(/filename="([^"]+)"/);
  return match?.[1] ?? `ventas-${new Date().toISOString().slice(0, 10)}.xlsx`;
}
