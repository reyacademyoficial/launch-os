"use client";

import { useActionState, useEffect, useState } from "react";

import type { CommissionActionState } from "@/app/(app)/proyectos/[projectId]/comisiones/actions";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { PaymentModalityRow } from "@/lib/commissions/types";

type FormAction = (
  prev: CommissionActionState,
  formData: FormData,
) => Promise<CommissionActionState>;

export function RuleForm({
  action,
  modalities,
  launches,
  submitLabel,
  onSuccess,
}: {
  readonly action: FormAction;
  readonly modalities: ReadonlyArray<PaymentModalityRow>;
  readonly launches: ReadonlyArray<{ id: string; name: string }>;
  readonly submitLabel: string;
  readonly onSuccess?: () => void;
}) {
  const [state, formAction, pending] = useActionState<CommissionActionState, FormData>(
    action,
    null,
  );
  const [type, setType] = useState<"percent" | "fixed">("percent");

  useEffect(() => {
    if (state && "ok" in state && state.ok) onSuccess?.();
  }, [state, onSuccess]);

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <Label htmlFor="rule-modality">Modalidad *</Label>
        <Select
          id="rule-modality"
          name="payment_modality_id"
          required
          defaultValue=""
        >
          <option value="" disabled>
            Elegí una modalidad
          </option>
          {modalities
            .filter((m) => m.active)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
        </Select>
      </div>

      <div>
        <Label htmlFor="rule-launch">Lanzamiento (opcional, override)</Label>
        <Select id="rule-launch" name="launch_id" defaultValue="">
          <option value="">— Regla default del proyecto —</option>
          {launches.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
        <p className="mt-1 text-xs text-fg-subtle">
          Si elegís un lanzamiento, esta regla pisa la default para ese launch.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="rule-type">Tipo *</Label>
          <Select
            id="rule-type"
            name="type"
            value={type}
            onChange={(e) => setType(e.target.value as "percent" | "fixed")}
          >
            <option value="percent">% del cobrado</option>
            <option value="fixed">Monto fijo (proporcional)</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="rule-value">
            {type === "percent" ? "%" : "Monto"} *
          </Label>
          <Input
            id="rule-value"
            name="value"
            type="number"
            step="0.01"
            min="0"
            required
            placeholder={type === "percent" ? "10" : "500"}
          />
        </div>
      </div>

      <p className="text-xs text-fg-subtle">
        El monto fijo se prorratea por el cobrado: si la regla son $500 y se
        cobró el 50% del total pactado, la comisión es $250.
      </p>

      <div className="flex items-center gap-4 pt-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : submitLabel}
        </Button>
        {state && "error" in state && <FieldError>{state.error}</FieldError>}
      </div>
    </form>
  );
}
