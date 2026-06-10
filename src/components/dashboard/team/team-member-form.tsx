"use client";

import { useActionState, useEffect } from "react";

import type { TeamActionState } from "@/app/(app)/proyectos/[projectId]/equipo/actions";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { TeamMemberRow } from "@/lib/team/types";

const ROLE_OPTIONS = [
  { value: "setter", label: "Setter" },
  { value: "closer", label: "Closer" },
  { value: "media_buyer", label: "Media buyer" },
  { value: "manager", label: "Manager" },
  { value: "otro", label: "Otro" },
] as const;

type FormState = TeamActionState;
type FormAction = (prev: FormState, formData: FormData) => Promise<FormState>;

export function TeamMemberForm({
  action,
  initial,
  submitLabel,
  onSuccess,
}: {
  readonly action: FormAction;
  readonly initial?: TeamMemberRow;
  readonly submitLabel: string;
  readonly onSuccess?: () => void;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, null);

  useEffect(() => {
    if (state && "ok" in state && state.ok) onSuccess?.();
  }, [state, onSuccess]);

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <Label htmlFor="tm-name">Nombre *</Label>
        <Input
          id="tm-name"
          name="name"
          required
          defaultValue={initial?.name ?? ""}
          placeholder="Ej: Juan Pérez"
        />
      </div>

      <div>
        <Label htmlFor="tm-role">Rol *</Label>
        <Select id="tm-role" name="role" defaultValue={initial?.role ?? "setter"}>
          {ROLE_OPTIONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <Label htmlFor="tm-rate">% comisión (opcional)</Label>
        <Input
          id="tm-rate"
          name="commission_rate"
          type="number"
          step="0.01"
          min="0"
          defaultValue={
            typeof initial?.commission_rate === "number"
              ? String(initial.commission_rate)
              : ""
          }
          placeholder="Ej: 10"
        />
        <p className="mt-1 text-xs text-fg-subtle">
          Referencial. La regla de comisión autoritativa se configura por
          modalidad de pago (4b).
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm text-fg-muted">
        <input
          type="checkbox"
          name="active"
          defaultChecked={initial?.active ?? true}
          className="accent-accent"
        />
        Activo
      </label>

      <div className="flex items-center gap-4 pt-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : submitLabel}
        </Button>
        {state && "error" in state && <FieldError>{state.error}</FieldError>}
      </div>
    </form>
  );
}
