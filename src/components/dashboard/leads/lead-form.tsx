"use client";

import { useActionState, useEffect } from "react";

import type { LeadActionState } from "@/app/(app)/proyectos/[projectId]/leads/actions";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { LEAD_STATUSES, LEAD_STATUS_LABELS, type LeadRow } from "@/lib/leads/types";
import type { TeamMemberRow } from "@/lib/team/types";

type FormState = LeadActionState;
type FormAction = (prev: FormState, formData: FormData) => Promise<FormState>;

export function LeadForm({
  action,
  initial,
  submitLabel,
  onSuccess,
  teamMembers,
  launches,
}: {
  readonly action: FormAction;
  readonly initial?: LeadRow;
  readonly submitLabel: string;
  readonly onSuccess?: () => void;
  readonly teamMembers: ReadonlyArray<Pick<TeamMemberRow, "id" | "name" | "active">>;
  readonly launches: ReadonlyArray<{ id: string; name: string }>;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, null);

  useEffect(() => {
    if (state && "ok" in state && state.ok) onSuccess?.();
  }, [state, onSuccess]);

  // Fallback: si el lead apunta a un team_member que ya no está activo, igual
  // lo dejamos en el select para no perder la asignación.
  const showInactiveAssignee =
    initial?.team_member_id !== null &&
    initial?.team_member_id !== undefined &&
    !teamMembers.some((t) => t.id === initial.team_member_id);

  // Traza de evergreen: si el lead llegó por reciclado, mostramos de qué
  // launch vino (read-only — la traza no es editable).
  const recycledFromName = initial?.recycled_from_launch_id
    ? launches.find((l) => l.id === initial.recycled_from_launch_id)?.name ?? null
    : null;

  return (
    <form action={formAction} className="space-y-4">
      {recycledFromName && (
        <div className="rounded-md border border-accent/30 bg-accent/5 px-3 py-2 text-xs text-fg-muted">
          ↩ Reciclado desde el evergreen <b className="text-fg">{recycledFromName}</b>
        </div>
      )}

      <div>
        <Label htmlFor="lead-name">Nombre *</Label>
        <Input
          id="lead-name"
          name="name"
          required
          defaultValue={initial?.name ?? ""}
          placeholder="Ej: Juan Pérez"
        />
      </div>

      <div>
        <Label htmlFor="lead-contact">Contacto (tel / email)</Label>
        <Input
          id="lead-contact"
          name="contact"
          defaultValue={initial?.contact ?? ""}
          placeholder="+54 911… o juan@…"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="lead-status">Status</Label>
          <Select id="lead-status" name="status" defaultValue={initial?.status ?? "nuevo"}>
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {LEAD_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="lead-assignee">Asignado a</Label>
          <Select
            id="lead-assignee"
            name="team_member_id"
            defaultValue={initial?.team_member_id ?? ""}
          >
            <option value="">— Sin asignar —</option>
            {teamMembers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {!t.active ? " (inactivo)" : ""}
              </option>
            ))}
            {showInactiveAssignee && initial?.team_member_id && (
              <option value={initial.team_member_id}>(asignación anterior)</option>
            )}
          </Select>
        </div>
      </div>

      <div>
        <Label htmlFor="lead-launch">Lanzamiento (opcional)</Label>
        <Select
          id="lead-launch"
          name="launch_id"
          defaultValue={initial?.launch_id ?? ""}
        >
          <option value="">— Sin asociar —</option>
          {launches.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <Label htmlFor="lead-notes">Notas</Label>
        <textarea
          id="lead-notes"
          name="notes"
          rows={3}
          defaultValue={initial?.notes ?? ""}
          className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent"
          placeholder="Origen, contexto, próximos pasos…"
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
