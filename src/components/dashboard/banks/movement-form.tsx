"use client";

import { useActionState, useEffect } from "react";

import type { BankMovementActionState } from "@/app/(app)/proyectos/[projectId]/bancos/actions";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { BankMovementRow } from "@/lib/banks/types";
import { todayInAR } from "@/lib/installments/status";

type FormAction = (
  prev: BankMovementActionState,
  formData: FormData,
) => Promise<BankMovementActionState>;

export function MovementForm({
  action,
  initial,
  submitLabel,
  onSuccess,
}: {
  readonly action: FormAction;
  readonly initial?: BankMovementRow;
  readonly submitLabel: string;
  readonly onSuccess?: () => void;
}) {
  const [state, formAction, pending] = useActionState<
    BankMovementActionState,
    FormData
  >(action, null);

  useEffect(() => {
    if (state && "ok" in state && state.ok) onSuccess?.();
  }, [state, onSuccess]);

  const defaultDate = initial?.occurred_at ?? todayInAR();

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <Label htmlFor="mv-kind">Tipo *</Label>
        <Select
          id="mv-kind"
          name="kind"
          required
          defaultValue={initial?.kind ?? "in"}
        >
          <option value="in">Entrada (aumenta el saldo)</option>
          <option value="out">Salida (disminuye el saldo)</option>
        </Select>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="mv-amount">Monto *</Label>
          <Input
            id="mv-amount"
            name="amount"
            type="number"
            step="0.01"
            min="0.01"
            required
            defaultValue={initial ? String(initial.amount) : ""}
            placeholder="100"
          />
        </div>
        <div>
          <Label htmlFor="mv-date">Fecha *</Label>
          <Input
            id="mv-date"
            name="occurred_at"
            type="date"
            required
            defaultValue={defaultDate}
          />
        </div>
      </div>
      <div>
        <Label htmlFor="mv-desc">Descripción</Label>
        <Input
          id="mv-desc"
          name="description"
          defaultValue={initial?.description ?? ""}
          placeholder="Opcional — ej: “retiro Elbio”, “ads Meta agosto”"
        />
      </div>
      <div className="flex items-center gap-4 pt-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : submitLabel}
        </Button>
        {state && "error" in state && <FieldError>{state.error}</FieldError>}
      </div>
    </form>
  );
}
