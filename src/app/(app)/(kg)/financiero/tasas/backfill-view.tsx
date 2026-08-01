"use client";

import { useActionState } from "react";

import type { FxBackfillReport } from "@/lib/backfill/fx";

import {
  previewFxBackfillAction,
  runFxBackfillAction,
  type FxBackfillState,
} from "./actions";

/**
 * Panel de backfill FX. Dos formularios independientes:
 *  1. "Simular" (preview): cuenta candidatos, no aplica. Se usa como
 *     dry-run antes de correr el backfill real.
 *  2. "Aplicar" (run): dispara los UPDATE sobre payments y sales. La UI
 *     no oculta el botón — el backfill es idempotente (skipea filas ya
 *     migradas), así que corrida N veces = mismo estado. Aún así,
 *     conviene revisar el reporte del preview antes.
 *
 * Confirmación nativa antes de aplicar — el operador puede haber cargado
 * mal una tasa y prefiere que no le sorprenda.
 */
export function BackfillView() {
  const [previewState, previewAction, previewPending] = useActionState<
    FxBackfillState,
    FormData
  >(previewFxBackfillAction, null);
  const [runState, runAction, runPending] = useActionState<
    FxBackfillState,
    FormData
  >(runFxBackfillAction, null);

  // Mostramos el reporte más reciente entre los dos.
  const displayReport =
    runState && "ok" in runState && runState.ok
      ? { source: "run" as const, report: runState.report }
      : previewState && "ok" in previewState && previewState.ok
        ? { source: "preview" as const, report: previewState.report }
        : null;

  const displayError =
    (runState && "error" in runState && runState.error) ||
    (previewState && "error" in previewState && previewState.error) ||
    null;

  return (
    <div
      style={{
        padding: 14,
        borderBottom: "1px solid var(--kg-border-subtle)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div>
        <h3
          className="kg-t4"
          style={{ margin: 0, marginBottom: 4, color: "var(--kg-text-1)" }}
        >
          Backfill de cobros históricos en pesos
        </h3>
        <p
          className="kg-t7"
          style={{ margin: 0, color: "var(--kg-text-3)", maxWidth: 720 }}
        >
          Convierte a USD los payments y sales cargados en pesos contra
          bancos USD (por costumbre, cuando la operación era todo en pesos).
          Usa la tasa del launch del cobro; si el cobro no tiene launch, cae
          a la tasa mensual del proyecto. Idempotente: guarda el monto
          original en <code>original_amount</code> y skipea filas ya
          migradas.
        </p>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <form action={previewAction}>
          <button
            type="submit"
            disabled={previewPending || runPending}
            className="kg-focus"
            style={{
              padding: "8px 16px",
              borderRadius: 999,
              background: "transparent",
              border: "1px solid var(--kg-border-subtle)",
              color: "var(--kg-text-1)",
              fontSize: 12,
              fontWeight: 700,
              cursor: previewPending ? "wait" : "pointer",
              opacity: previewPending ? 0.7 : 1,
            }}
          >
            {previewPending ? "Simulando…" : "Simular (dry-run)"}
          </button>
        </form>

        <form
          action={runAction}
          onSubmit={(e) => {
            if (
              !confirm(
                "Vas a convertir a USD todos los payments/sales en pesos contra bancos USD. Es idempotente pero conviene revisar antes el dry-run. ¿Continuar?",
              )
            ) {
              e.preventDefault();
            }
          }}
        >
          <button
            type="submit"
            disabled={previewPending || runPending}
            className="kg-focus"
            style={{
              padding: "8px 16px",
              borderRadius: 999,
              background: "#EF4444",
              border: "none",
              color: "#fff",
              fontSize: 12,
              fontWeight: 700,
              cursor: runPending ? "wait" : "pointer",
              opacity: runPending ? 0.7 : 1,
            }}
          >
            {runPending ? "Aplicando…" : "Aplicar backfill"}
          </button>
        </form>
      </div>

      {displayError && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: "var(--kg-r-8)",
            background: "rgba(239,68,68,0.10)",
            border: "1px solid #EF4444",
            color: "#EF4444",
            fontSize: 12,
          }}
        >
          {displayError}
        </div>
      )}

      {displayReport && (
        <ReportPanel
          source={displayReport.source}
          report={displayReport.report}
        />
      )}
    </div>
  );
}

function ReportPanel({
  source,
  report,
}: {
  readonly source: "preview" | "run";
  readonly report: FxBackfillReport;
}) {
  const isRun = source === "run";
  return (
    <div
      style={{
        padding: 12,
        borderRadius: "var(--kg-r-8)",
        background: "var(--kg-surface-2-solid)",
        border: "1px solid var(--kg-border-subtle)",
        fontSize: 12,
        color: "var(--kg-text-2)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ fontWeight: 700, color: "var(--kg-text-1)" }}>
        {isRun ? "Backfill aplicado" : "Simulación (nada se aplicó)"}
      </div>
      <div>
        <b>Payments</b>: {report.paymentsScanned} candidatos ·{" "}
        {report.paymentsConverted} {isRun ? "convertidos" : "a convertir"} ·{" "}
        {report.paymentsSkippedNoRate} sin tasa ·{" "}
        {report.paymentsSkippedNoBank} sin banco (defensivo)
      </div>
      <div>
        <b>Sales</b>: {report.salesScanned} candidatos ·{" "}
        {report.salesConverted} {isRun ? "convertidos" : "a convertir"} ·{" "}
        {report.salesSkippedNoRate} sin tasa del launch
      </div>
      {report.problemPaymentIds.length > 0 && (
        <div style={{ color: "#FFB800" }}>
          Payments sin conversión (primeros {report.problemPaymentIds.length}):{" "}
          <code style={{ fontSize: 10 }}>
            {report.problemPaymentIds.join(", ")}
          </code>
        </div>
      )}
      {report.problemSaleIds.length > 0 && (
        <div style={{ color: "#FFB800" }}>
          Sales sin conversión (primeros {report.problemSaleIds.length}):{" "}
          <code style={{ fontSize: 10 }}>
            {report.problemSaleIds.join(", ")}
          </code>
        </div>
      )}
    </div>
  );
}
