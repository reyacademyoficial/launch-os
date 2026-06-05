"use client";

import { useActionState } from "react";

import type { ProjectActionState } from "@/app/(admin)/admin/proyectos/actions";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type FormAction = (
  prev: ProjectActionState,
  formData: FormData,
) => Promise<ProjectActionState>;

interface Initial {
  name: string;
  business_name: string | null;
}

export function ProjectForm({
  action,
  initial,
  submitLabel,
}: {
  readonly action: FormAction;
  readonly initial?: Initial;
  readonly submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState<ProjectActionState, FormData>(
    action,
    null,
  );

  return (
    <form action={formAction} className="max-w-lg space-y-5">
      <div>
        <Label htmlFor="name">Nombre *</Label>
        <Input
          id="name"
          name="name"
          type="text"
          required
          autoComplete="off"
          defaultValue={initial?.name ?? ""}
          placeholder="Mi proyecto"
        />
        <p className="mt-1 text-xs text-fg-subtle">
          Nombre interno con el que se identifica el proyecto en la app.
        </p>
      </div>

      <div>
        <Label htmlFor="business_name">Razón social</Label>
        <Input
          id="business_name"
          name="business_name"
          type="text"
          autoComplete="off"
          defaultValue={initial?.business_name ?? ""}
          placeholder="Opcional"
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
