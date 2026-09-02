"use client";

import { useActionState } from "react";

import {
  ErrorBanner,
  Field,
  inputStyle,
  primaryBtn,
} from "@/components/kg/form-primitives";
import { StateDot } from "@/components/kg/state-dot";
import { StatusPill } from "@/components/kg/status-pill";
import { TONE_VAR } from "@/components/kg/tone";
import {
  ALERT_METRIC_HINTS,
  ALERT_METRIC_LABELS,
  ALERT_METRICS,
  ALERT_OPERATORS,
} from "@/lib/alerts/types";

import { createAlertRule, type AlertActionState } from "./actions";

/**
 * Form de creación de regla de alerta. Inline en la página, sin modal — el
 * panel cabe en pantalla y el flujo es chico.
 *
 * Los operadores siguen visibles para `sin_leads` pero el evaluator los
 * ignora (la semántica es siempre `>=`). Hint en la UI explica eso.
 *
 * MIGRACIÓN KG
 * `Label`/`Input`/`Select`/`Button`/`FieldError` de `components/ui` pasan a
 * `Field` + `inputStyle` + `primaryBtn` + `ErrorBanner`. La caja propia
 * (`rounded-md border-border bg-surface p-4`) desaparece: el form ya va
 * adentro de un `Panel` en la page, y dos superficies anidadas se leían como
 * un doble marco.
 *
 * Los `<select>` quedan nativos con `inputStyle` (mismo patrón que
 * `session-form-drawer.tsx`): `KgFilterSelect` navega por URL con
 * `router.push`, no emite valor al FormData, así que no sirve como control
 * de un `<form action={...}>`.
 *
 * El grid responsive se queda en Tailwind — es exactamente el caso que el
 * design system reserva para clases: breakpoints.
 */
export function AlertRuleForm({
  projectId,
  launchId,
}: {
  readonly projectId: string;
  readonly launchId: string;
}) {
  const action = createAlertRule.bind(null, projectId, launchId);
  const [state, formAction, pending] = useActionState<AlertActionState, FormData>(
    action,
    null,
  );

  return (
    <form
      action={formAction}
      style={{ display: "flex", flexDirection: "column", gap: 14 }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Field label="Métrica" htmlFor="metric" required>
          <select
            id="metric"
            name="metric"
            defaultValue="cpl"
            required
            style={inputStyle}
          >
            {ALERT_METRICS.map((m) => (
              <option key={m} value={m}>
                {ALERT_METRIC_LABELS[m]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Operador" htmlFor="operator" required>
          <select
            id="operator"
            name="operator"
            defaultValue=">"
            required
            style={inputStyle}
          >
            {ALERT_OPERATORS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Umbral" htmlFor="threshold" required>
          <input
            id="threshold"
            name="threshold"
            type="number"
            min={0}
            step="0.01"
            placeholder="ej. 20"
            required
            style={inputStyle}
          />
        </Field>

        {/*
          El botón se alinea al pie de la grilla para quedar a la altura de los
          inputs — en 1 columna (mobile) simplemente cae abajo.
        */}
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <button
            type="submit"
            disabled={pending}
            className="kg-focus"
            style={{
              ...primaryBtn,
              width: "100%",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 7,
              opacity: pending ? 0.5 : 1,
              cursor: pending ? "not-allowed" : "pointer",
            }}
          >
            {pending && <StateDot tone="accent" />}
            {pending ? "Creando…" : "Crear regla"}
          </button>
        </div>
      </div>

      <p className="kg-t7" style={{ color: "var(--kg-text-3)", margin: 0 }}>
        <strong style={{ color: "var(--kg-text-2)" }}>CPL:</strong>{" "}
        {ALERT_METRIC_HINTS.cpl}.{" "}
        <strong style={{ color: "var(--kg-text-2)" }}>Inversión:</strong>{" "}
        {ALERT_METRIC_HINTS.inversion}.{" "}
        <strong style={{ color: "var(--kg-text-2)" }}>Días sin leads:</strong>{" "}
        {ALERT_METRIC_HINTS.sin_leads} — el operador se ignora para esta
        métrica (siempre evalúa ≥ umbral).
      </p>

      {state && "error" in state && <ErrorBanner message={state.error} />}
      {state && "ok" in state && (
        // El "creada" es estado, no texto verde: StatusPill deja el color en
        // el dot y el texto neutro.
        <StatusPill text="Regla creada" tone={TONE_VAR.positive} />
      )}
    </form>
  );
}
