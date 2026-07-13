"use client";

import { useActionState, useEffect } from "react";

import type { ProductActionState } from "@/app/(app)/proyectos/[projectId]/productos/actions";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ProductRow } from "@/lib/products/types";

type FormAction = (
  prev: ProductActionState,
  formData: FormData,
) => Promise<ProductActionState>;

export function ProductForm({
  action,
  initial,
  submitLabel,
  onSuccess,
}: {
  readonly action: FormAction;
  readonly initial?: ProductRow;
  readonly submitLabel: string;
  readonly onSuccess?: () => void;
}) {
  const [state, formAction, pending] = useActionState<
    ProductActionState,
    FormData
  >(action, null);

  useEffect(() => {
    if (state && "ok" in state && state.ok) onSuccess?.();
  }, [state, onSuccess]);

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <Label htmlFor="prod-name">Nombre *</Label>
        <Input
          id="prod-name"
          name="name"
          required
          defaultValue={initial?.name ?? ""}
          placeholder='Ej: "Mentoría 6m", "Curso Anual"'
        />
      </div>
      <div>
        <Label htmlFor="prod-description">Descripción</Label>
        <Input
          id="prod-description"
          name="description"
          defaultValue={initial?.description ?? ""}
          placeholder="Opcional — nota interna del catálogo"
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
