"use client";

import { useEffect, useState, useTransition } from "react";

import type {
  RecalculateBulkFilters,
  RecalculateBulkPreview,
  RecalculateBulkResult,
} from "@/app/(app)/(kg)/proyectos/[projectId]/leads/sale-actions";
import { Drawer } from "@/components/kg/drawer";
import {
  ErrorBanner,
  primaryBtn,
  secondaryBtn,
} from "@/components/kg/form-primitives";
import { StateDot } from "@/components/kg/state-dot";

type PreviewAction = (
  filters: RecalculateBulkFilters,
) => Promise<RecalculateBulkPreview | { error: string }>;
type ExecuteAction = (
  filters: RecalculateBulkFilters,
) => Promise<RecalculateBulkResult | { error: string }>;

interface RecalculateBulkModalProps {
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
}

/**
 * Recalculo bulk de comisiones. El caller preseta los filtros (`launchId` y/o
 * `productId`) según desde dónde se abrió (detalle de launch, catálogo de
 * productos, etc.) — el usuario elige el scope (pendientes vs todas) y ve un
 * preview del count antes de ejecutar.
 *
 * Las actions vienen bindeadas al `projectId` desde el server component
 * padre — misma convención que el resto de acciones del feature.
 *
 * MIGRACIÓN AL DS KG
 * El modal centrado hecho a mano (div fixed + overlay + tokens viejos) pasó a
 * `Drawer`, y los botones/inputs a `form-primitives`. El preview NO va en
 * `KgDataTable`: `RecalculateBulkPreview` es un único `totalMatches`, no un
 * dataset — una tabla con header y footer para un número sería ceremonia.
 *
 * POR QUÉ EL ESTADO VIVE EN UN COMPONENTE APARTE (`BulkRecalcDrawer`)
 * Antes había un `useEffect` que, al cerrarse, seteaba `preview`,
 * `previewError` y `result` a null para dejar el modal limpio para la próxima
 * apertura. Eso es exactamente el patrón que ESLint marca como
 * `react-hooks/set-state-in-effect` (era un ERROR preexistente en este
 * archivo). La solución no es silenciarlo: el drawer se monta con
 * `{open && …}`, así que al cerrar el subárbol se DESMONTA y todo su estado
 * nace limpio en la siguiente apertura. Sin efecto de sincronización, sin
 * resets manuales, mismo comportamiento observable.
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
}: RecalculateBulkModalProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`kg-focus${triggerClassName ? ` ${triggerClassName}` : ""}`}
        style={triggerVariant === "primary" ? primaryBtn : secondaryBtn}
      >
        {triggerLabel}
      </button>
      {open && (
        <BulkRecalcDrawer
          title={title}
          scopeDescription={scopeDescription}
          fixedLaunchId={fixedLaunchId}
          fixedProductId={fixedProductId}
          previewAction={previewAction}
          executeAction={executeAction}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function BulkRecalcDrawer({
  title,
  scopeDescription,
  fixedLaunchId,
  fixedProductId,
  previewAction,
  executeAction,
  onClose,
}: {
  readonly title: string;
  readonly scopeDescription: string;
  readonly fixedLaunchId: string | null;
  readonly fixedProductId: string | null;
  readonly previewAction: PreviewAction;
  readonly executeAction: ExecuteAction;
  readonly onClose: () => void;
}) {
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

  // Preview vivo — corre al montar (o sea, al abrir) y cada vez que cambia el
  // scope. La action retorna dry-run count sin tocar la DB.
  useEffect(() => {
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
  }, [scope, fixedLaunchId, fixedProductId]);

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
  const canExecute =
    !previewPending && !executePending && previewCount > 0 && !result;

  return (
    <Drawer
      open
      onClose={onClose}
      title={title}
      subtitle={scopeDescription}
      width={460}
      footer={
        // Slot único del Drawer, FUERA de cualquier <form>. Acá no hay form:
        // el recalculo se dispara por handler, así que los botones no
        // necesitan `form={id}`.
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={executePending}
            className="kg-focus"
            style={{
              ...secondaryBtn,
              opacity: executePending ? 0.5 : 1,
              cursor: executePending ? "not-allowed" : "pointer",
            }}
          >
            {result ? "Cerrar" : "Cancelar"}
          </button>
          {!result && (
            <button
              type="button"
              onClick={execute}
              disabled={!canExecute}
              className="kg-focus"
              style={{
                ...primaryBtn,
                opacity: canExecute ? 1 : 0.5,
                cursor: canExecute ? "pointer" : "not-allowed",
              }}
            >
              {executePending ? "Recalculando…" : "Recalcular"}
            </button>
          )}
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {/*
          Radios NATIVOS: son dos opciones excluyentes con descripción larga
          debajo de cada label — un select del DS escondería el texto que
          explica la diferencia, que es justo lo que el humano necesita leer
          antes de sobrescribir comisiones históricas.
        */}
        <fieldset style={{ border: "none", margin: 0, padding: 0 }}>
          <legend
            className="kg-t7"
            style={{ color: "var(--kg-text-3)", marginBottom: 10, padding: 0 }}
          >
            Alcance del recalculo
          </legend>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <ScopeOption
              checked={scope === "pending"}
              disabled={executePending}
              onSelect={() => setScope("pending")}
              label="Solo con cobros pendientes"
              description="Ventas con saldo > 0 (no totalmente cobradas todavía)."
            />
            <ScopeOption
              checked={scope === "all"}
              disabled={executePending}
              onSelect={() => setScope("all")}
              label="Todas las ventas del scope"
              description="Incluye ventas ya totalmente cobradas — la comisión histórica se sobreescribe con la regla vigente."
            />
          </div>
        </fieldset>

        {/* Preview del dry-run */}
        {previewError ? (
          <ErrorBanner message={previewError} />
        ) : (
          <div
            aria-live="polite"
            style={{
              borderRadius: "var(--kg-r-8)",
              border: "1px solid var(--kg-border-subtle)",
              background: "var(--kg-surface-2-solid)",
              padding: "10px 14px",
              fontSize: 12.5,
              color: "var(--kg-text-2)",
            }}
          >
            {previewPending ? (
              <span style={{ color: "var(--kg-text-3)" }}>Calculando…</span>
            ) : preview ? (
              <>
                <strong className="kg-num" style={{ color: "var(--kg-text-1)" }}>
                  {preview.totalMatches}
                </strong>{" "}
                venta{preview.totalMatches === 1 ? "" : "s"} van a ser
                recalculada{preview.totalMatches === 1 ? "" : "s"}.
              </>
            ) : (
              <span style={{ color: "var(--kg-text-3)" }}>—</span>
            )}
          </div>
        )}

        {/*
          Resultado. El texto NO se pinta: el tono viaja en el StateDot, igual
          que en el resto del DS. Cuando hay fallos el detalle va en el
          ErrorBanner, que sí es un error accionable.
        */}
        {result && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div
              role="status"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                borderRadius: "var(--kg-r-8)",
                border: "1px solid var(--kg-border-subtle)",
                background: "var(--kg-surface-2-solid)",
                padding: "10px 14px",
                fontSize: 12.5,
                color: "var(--kg-text-1)",
              }}
            >
              <StateDot tone={result.failed === 0 ? "positive" : "negative"} />
              {result.failed === 0 ? (
                <span>
                  {result.updated} venta{result.updated === 1 ? "" : "s"}{" "}
                  actualizada{result.updated === 1 ? "" : "s"}.
                </span>
              ) : (
                <span>
                  {result.updated} OK · {result.failed} con error
                </span>
              )}
            </div>
            {result.firstError && (
              <ErrorBanner message={`Primer error: ${result.firstError}`} />
            )}
          </div>
        )}
      </div>
    </Drawer>
  );
}

/** Una opción del radio de scope: control nativo + label + descripción. */
function ScopeOption({
  checked,
  disabled,
  onSelect,
  label,
  description,
}: {
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onSelect: () => void;
  readonly label: string;
  readonly description: string;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 9,
        cursor: disabled ? "not-allowed" : "pointer",
        borderRadius: "var(--kg-r-8)",
        border: `1px solid ${
          checked ? "var(--kg-border-accent)" : "var(--kg-border-subtle)"
        }`,
        background: "var(--kg-surface-2-solid)",
        padding: "10px 12px",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <input
        type="radio"
        name="recalc-scope"
        checked={checked}
        onChange={onSelect}
        disabled={disabled}
        className="kg-focus"
        style={{ marginTop: 2, accentColor: "var(--kg-accent-500)" }}
      />
      <span style={{ minWidth: 0 }}>
        <span
          style={{
            display: "block",
            fontSize: 12.5,
            fontWeight: 600,
            color: "var(--kg-text-1)",
          }}
        >
          {label}
        </span>
        {/* Sin `kg-t7`: esa clase es UPPERCASE (label), y acá el texto es una
            frase que se lee. Tamaño chico y color 3 alcanzan para bajarla de
            jerarquía. */}
        <span
          style={{
            display: "block",
            fontSize: 11.5,
            color: "var(--kg-text-3)",
            marginTop: 3,
            lineHeight: 1.45,
          }}
        >
          {description}
        </span>
      </span>
    </label>
  );
}
