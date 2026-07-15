"use client";

import { useActionState, useEffect } from "react";

import type { PaymentMethodActionState } from "@/app/(app)/proyectos/[projectId]/metodos-pago/actions";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { BankRow } from "@/lib/banks/types";
import type { PaymentMethodRow } from "@/lib/payment-methods/types";

type FormAction = (
  prev: PaymentMethodActionState,
  formData: FormData,
) => Promise<PaymentMethodActionState>;

export function PaymentMethodForm({
  action,
  initial,
  banks,
  submitLabel,
  onSuccess,
}: {
  readonly action: FormAction;
  readonly initial?: PaymentMethodRow;
  /** Bancos del proyecto disponibles para linkear. Omitido = sin dropdown. */
  readonly banks?: ReadonlyArray<Pick<BankRow, "id" | "name" | "active">>;
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

  // Bancos visibles: activos + el que ya tenga asignado el método (aunque esté
  // inactivo) para no perder la selección actual al editar.
  const visibleBanks =
    banks?.filter(
      (b) => b.active || b.id === initial?.bank_id,
    ) ?? [];

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
      {banks && (
        <div>
          <Label htmlFor="pm-bank">Banco destino</Label>
          <Select
            id="pm-bank"
            name="bank_id"
            defaultValue={initial?.bank_id ?? ""}
          >
            <option value="">— Sin banco —</option>
            {visibleBanks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {!b.active ? " (inactivo)" : ""}
              </option>
            ))}
          </Select>
          <p className="mt-1 text-xs text-fg-subtle">
            Cuenta donde depositan los cobros que entran por este método. Dejá
            en <b>Sin banco</b> para métodos que no van a una cuenta bancaria
            (efectivo, canjes, etc).
          </p>
        </div>
      )}
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
