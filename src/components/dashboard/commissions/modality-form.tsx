"use client";

import { useActionState, useEffect } from "react";

import type { CommissionActionState } from "@/app/(app)/proyectos/[projectId]/comisiones/actions";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PaymentModalityRow } from "@/lib/commissions/types";

type FormAction = (
  prev: CommissionActionState,
  formData: FormData,
) => Promise<CommissionActionState>;

export function ModalityForm({
  action,
  initial,
  submitLabel,
  onSuccess,
}: {
  readonly action: FormAction;
  readonly initial?: PaymentModalityRow;
  readonly submitLabel: string;
  readonly onSuccess?: () => void;
}) {
  const [state, formAction, pending] = useActionState<CommissionActionState, FormData>(
    action,
    null,
  );

  useEffect(() => {
    if (state && "ok" in state && state.ok) onSuccess?.();
  }, [state, onSuccess]);

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <Label htmlFor="mod-name">Nombre *</Label>
        <Input
          id="mod-name"
          name="name"
          required
          defaultValue={initial?.name ?? ""}
          placeholder='Ej: "Pago total", "3 cuotas"'
        />
      </div>
      {initial && (
        <label className="flex items-center gap-2 text-sm text-fg-muted">
          <input
            type="checkbox"
            name="active"
            defaultChecked={initial.active}
            className="accent-accent"
          />
          Activa
        </label>
      )}
      <div className="flex items-center gap-4 pt-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : submitLabel}
        </Button>
        {state && "error" in state && <FieldError>{state.error}</FieldError>}
      </div>
    </form>
  );
}
