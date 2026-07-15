"use client";

import { useActionState, useEffect } from "react";

import type { BankActionState } from "@/app/(app)/proyectos/[projectId]/bancos/actions";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { BankRow } from "@/lib/banks/types";

type FormAction = (
  prev: BankActionState,
  formData: FormData,
) => Promise<BankActionState>;

export function BankForm({
  action,
  initial,
  submitLabel,
  onSuccess,
}: {
  readonly action: FormAction;
  readonly initial?: BankRow;
  readonly submitLabel: string;
  readonly onSuccess?: () => void;
}) {
  const [state, formAction, pending] = useActionState<BankActionState, FormData>(
    action,
    null,
  );

  useEffect(() => {
    if (state && "ok" in state && state.ok) onSuccess?.();
  }, [state, onSuccess]);

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <Label htmlFor="bank-name">Nombre *</Label>
        <Input
          id="bank-name"
          name="name"
          required
          defaultValue={initial?.name ?? ""}
          placeholder='Ej: "Galicia AR", "Wise USD", "MercadoPago"'
        />
      </div>
      <div>
        <Label htmlFor="bank-opening">Saldo inicial</Label>
        <Input
          id="bank-opening"
          name="opening_balance"
          type="number"
          step="0.01"
          min="0"
          defaultValue={String(initial?.opening_balance ?? 0)}
          placeholder="0"
        />
        <p className="mt-1 text-xs text-fg-subtle">
          Plata que ya tenía la cuenta antes de empezar a trackear. Sumada a
          cobros y movimientos futuros.
        </p>
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
