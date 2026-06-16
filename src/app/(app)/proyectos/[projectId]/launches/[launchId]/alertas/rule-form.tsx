"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
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
    <form action={formAction} className="space-y-4 rounded-md border border-border bg-surface p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div>
          <Label htmlFor="metric">Métrica</Label>
          <Select id="metric" name="metric" defaultValue="cpl" required>
            {ALERT_METRICS.map((m) => (
              <option key={m} value={m}>
                {ALERT_METRIC_LABELS[m]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="operator">Operador</Label>
          <Select id="operator" name="operator" defaultValue=">" required>
            {ALERT_OPERATORS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="threshold">Umbral</Label>
          <Input
            id="threshold"
            name="threshold"
            type="number"
            min={0}
            step="0.01"
            placeholder="ej. 20"
            required
          />
        </div>
        <div className="flex items-end">
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Creando…" : "Crear regla"}
          </Button>
        </div>
      </div>

      <p className="text-xs text-fg-subtle">
        <strong>CPL:</strong> {ALERT_METRIC_HINTS.cpl}.{" "}
        <strong>Inversión:</strong> {ALERT_METRIC_HINTS.inversion}.{" "}
        <strong>Días sin leads:</strong> {ALERT_METRIC_HINTS.sin_leads} — el
        operador se ignora para esta métrica (siempre evalúa ≥ umbral).
      </p>

      {state && "error" in state && <FieldError>{state.error}</FieldError>}
      {state && "ok" in state && (
        <p className="text-xs text-success">Regla creada.</p>
      )}
    </form>
  );
}
