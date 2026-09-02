"use client";

import { useEffect, useState, useTransition } from "react";

import type {
  RecalculateBulkFilters,
  RecalculateBulkPreview,
  RecalculateBulkResult,
} from "@/app/(app)/(kg)/proyectos/[projectId]/leads/sale-actions";
import { Button } from "@/components/ui/button";

type PreviewAction = (
  filters: RecalculateBulkFilters,
) => Promise<RecalculateBulkPreview | { error: string }>;
type ExecuteAction = (
  filters: RecalculateBulkFilters,
) => Promise<RecalculateBulkResult | { error: string }>;

/**
 * Modal reutilizable para el recalculo bulk de comisiones. El caller preseta
 * los filtros (`launchId` y/o `productId`) según desde dónde se abrió (detalle
 * de launch, catálogo de productos, etc.) — el usuario elige el scope
 * (pendientes vs todas) y el modal muestra un preview del count antes de
 * ejecutar.
 *
 * Las actions vienen bindeadas al `projectId` desde el server component
 * padre — misma convención que el resto de acciones del feature.
 */
export function RecalculateBulkModal({
  triggerLabel,
  triggerClassName,
  triggerVariant = "secondary",
  title,
  scopeDescription,
  fixedLaunchId = null,
  fixedProductId = null,
  previewAction,
  executeAction,
}: {
  readonly triggerLabel: string;
  readonly triggerClassName?: string;
  readonly triggerVariant?: "primary" | "secondary";
  readonly title: string;
  /** Copy que aclara sobre qué universo va a operar. */
  readonly scopeDescription: string;
  readonly fixedLaunchId?: string | null;
  readonly fixedProductId?: string | null;
  readonly previewAction: PreviewAction;
  readonly executeAction: ExecuteAction;
}) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<"pending" | "all">("pending");
  const [preview, setPreview] = useState<RecalculateBulkPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [result, setResult] = useState<RecalculateBulkResult | null>(null);
  const [previewPending, startPreviewTransition] = useTransition();
  const [executePending, startExecuteTransition] = useTransition();

  const filters: RecalculateBulkFilters = {
    launchId: fixedLaunchId,
    productId: fixedProductId,
    scope,
  };

  // Preview vivo — corre al abrir y cada vez que cambia scope. La action
  // retorna dry-run count sin tocar la DB.
  useEffect(() => {
    if (!open) {
      setPreview(null);
      setPreviewError(null);
      setResult(null);
      return;
    }
    startPreviewTransition(async () => {
      const r = await previewAction(filters);
      if ("error" in r) {
        setPreview(null);
        setPreviewError(r.error);
      } else {
        setPreview(r);
        setPreviewError(null);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scope, fixedLaunchId, fixedProductId]);

  function execute() {
    setResult(null);
    startExecuteTransition(async () => {
      const r = await executeAction(filters);
      if ("error" in r) {
        setResult({ updated: 0, failed: 0, firstError: r.error });
      } else {
        setResult(r);
      }
    });
  }

  const previewCount = preview?.totalMatches ?? 0;
  const canExecute = !previewPending && !executePending && previewCount > 0 && !result;

  return (
    <>
      <Button
        type="button"
        variant={triggerVariant}
        onClick={() => setOpen(true)}
        className={triggerClassName}
      >
        {triggerLabel}
      </Button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-md border border-border bg-bg-elevated shadow-card">
            <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
              <div>
                <h3 className="text-lg font-bold text-fg">{title}</h3>
                <p className="mt-0.5 text-xs text-fg-subtle">
                  {scopeDescription}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Cerrar"
                className="text-fg-subtle hover:text-fg"
              >
                ×
              </button>
            </header>

            <div className="space-y-5 px-6 py-6">
              {/* Radio scope */}
              <fieldset className="space-y-2 text-sm">
                <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
                  Alcance del recalculo
                </legend>
                <label className="flex cursor-pointer items-start gap-2">
                  <input
                    type="radio"
                    name="recalc-scope"
                    checked={scope === "pending"}
                    onChange={() => setScope("pending")}
                    disabled={executePending}
                    className="mt-1 accent-accent"
                  />
                  <div>
                    <div className="text-fg">Solo con cobros pendientes</div>
                    <div className="text-xs text-fg-subtle">
                      Sale con saldo &gt; 0 (no totalmente cobrada todavía).
                    </div>
                  </div>
                </label>
                <label className="flex cursor-pointer items-start gap-2">
                  <input
                    type="radio"
                    name="recalc-scope"
                    checked={scope === "all"}
                    onChange={() => setScope("all")}
                    disabled={executePending}
                    className="mt-1 accent-accent"
                  />
                  <div>
                    <div className="text-fg">Todas las ventas del scope</div>
                    <div className="text-xs text-fg-subtle">
                      Incluye ventas ya totalmente cobradas — la comisión
                      histórica se sobreescribe con la regla vigente.
                    </div>
                  </div>
                </label>
              </fieldset>

              {/* Preview */}
              <div className="rounded-md border border-border bg-surface/40 p-3 text-sm">
                {previewPending ? (
                  <span className="text-fg-subtle">Calculando…</span>
                ) : previewError ? (
                  <span className="text-error">{previewError}</span>
                ) : preview ? (
                  <span className="text-fg">
                    <b>{preview.totalMatches}</b> venta
                    {preview.totalMatches === 1 ? "" : "s"} van a ser
                    recalculadas.
                  </span>
                ) : (
                  <span className="text-fg-subtle">—</span>
                )}
              </div>

              {/* Result */}
              {result && (
                <div
                  className={
                    "rounded-md border p-3 text-sm " +
                    (result.failed === 0
                      ? "border-success/40 bg-success/5 text-success"
                      : "border-error/40 bg-error/5 text-error")
                  }
                >
                  {result.failed === 0 ? (
                    <span>
                      {result.updated} venta
                      {result.updated === 1 ? "" : "s"} actualizada
                      {result.updated === 1 ? "" : "s"}.
                    </span>
                  ) : (
                    <>
                      <span>
                        {result.updated} OK · {result.failed} con error
                      </span>
                      {result.firstError && (
                        <div className="mt-1 text-xs">
                          Primer error: {result.firstError}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={executePending}
                  className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-fg hover:bg-bg-elevated disabled:opacity-50"
                >
                  {result ? "Cerrar" : "Cancelar"}
                </button>
                {!result && (
                  <Button
                    type="button"
                    onClick={execute}
                    disabled={!canExecute}
                  >
                    {executePending ? "Recalculando…" : "Recalcular"}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
