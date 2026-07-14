"use client";

import { useActionState, useEffect } from "react";

import type { PaymentMethodActionState } from "@/app/(app)/proyectos/[projectId]/metodos-pago/actions";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PaymentMethodRow } from "@/lib/payment-methods/types";

type FormAction = (
  prev: PaymentMethodActionState,
  formData: FormData,
) => Promise<PaymentMethodActionState>;

export function PaymentMethodForm({
  action,
  initial,
  submitLabel,
  onSuccess,
}: {
  readonly action: FormAction;
  readonly initial?: PaymentMethodRow;
  readonly submitLabel: string;
  readonly onSuccess?: () => void;
}) {
  const [state, formAction, pending] = useActionState<
    PaymentMethodActionState,
    FormData
  >(action, null);

  useEffect(() => {
    if (state && "ok" in state && state.ok) onSuccess?.();
  }, [state, onSuccess]);

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <Label htmlFor="pm-name">Nombre *</Label>
        <Input
          id="pm-name"
          name="name"
          required
          defaultValue={initial?.name ?? ""}
          placeholder='Ej: "Transferencia", "Stripe", "Mercado Pago"'
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
          Activo
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
