"use client";

import { useActionState, useTransition } from "react";

import type {
  AssignmentActionState,
} from "@/app/(app)/proyectos/[projectId]/launches/[launchId]/assignment-actions";
import {
  assignUserToLaunch,
  removeAssignment,
  setAssignmentCanEdit,
} from "@/app/(app)/proyectos/[projectId]/launches/[launchId]/assignment-actions";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type {
  AssignableMember,
  LaunchAssignee,
} from "@/lib/launch-assignments/list";

/**
 * Manages the launch_assignments list for a single launch. Rendered inside the
 * launch detail page for admin/superadmin (the page itself gates the section).
 *
 * Layout:
 *   - Top: existing assignees with their role badge + (for operador) a
 *     can_edit toggle + remove button.
 *   - Bottom: "Asignar usuario" form — pick from the project's operador/cliente
 *     members not yet on the list, with an optional can_edit flag for
 *     operadores.
 */
export function LaunchAssignmentsSection({
  projectId,
  launchId,
  assignees,
  assignable,
}: {
  readonly projectId: string;
  readonly launchId: string;
  readonly assignees: readonly LaunchAssignee[];
  readonly assignable: readonly AssignableMember[];
}) {
  const boundAssign = assignUserToLaunch.bind(null, projectId, launchId);
  const [state, formAction, pending] = useActionState<
    AssignmentActionState,
    FormData
  >(boundAssign, null);

  return (
    <section className="space-y-4">
      <header>
        <h2 className="text-base font-semibold text-fg">Asignados</h2>
        <p className="text-xs text-fg-subtle">
          Quién accede a este lanzamiento sin pertenecer al proyecto entero.
          Operadores y clientes solo ven lo que les asignás acá.
        </p>
      </header>

      {assignees.length === 0 ? (
        <p className="rounded-md border border-dashed border-border bg-surface/40 p-4 text-center text-sm text-fg-muted">
          Sin asignaciones. Admin y analista ya ven el lanzamiento por
          pertenencia al proyecto — operadores y clientes necesitan estar acá.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {assignees.map((a) => (
            <AssigneeRow
              key={a.assignmentId}
              projectId={projectId}
              launchId={launchId}
              assignee={a}
            />
          ))}
        </ul>
      )}

      <form
        action={formAction}
        className="rounded-md border border-border bg-surface/40 p-4"
      >
        <h3 className="text-sm font-semibold text-fg">Asignar usuario</h3>
        <p className="mt-1 text-xs text-fg-subtle">
          Solo aparecen los miembros del proyecto con rol operador o cliente que
          todavía no están asignados.
        </p>

        {assignable.length === 0 ? (
          <p className="mt-3 text-xs text-fg-muted">
            No hay más operadores ni clientes del proyecto para asignar.
          </p>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <div>
              <Label htmlFor="assign-user">Usuario</Label>
              <Select id="assign-user" name="user_id" required defaultValue="">
                <option value="" disabled>
                  Elegí uno…
                </option>
                {assignable.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {(m.fullName ?? m.email) + ` · ${m.role}`}
                  </option>
                ))}
              </Select>
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm text-fg">
              <input
                type="checkbox"
                name="can_edit"
                value="true"
                className="accent-accent"
              />
              <span>can_edit (solo operador)</span>
            </label>
            <Button type="submit" disabled={pending}>
              {pending ? "Asignando…" : "Asignar"}
            </Button>
          </div>
        )}

        {state && "error" in state && (
          <div className="mt-3">
            <FieldError>{state.error}</FieldError>
          </div>
        )}
      </form>
    </section>
  );
}

function AssigneeRow({
  projectId,
  launchId,
  assignee,
}: {
  readonly projectId: string;
  readonly launchId: string;
  readonly assignee: LaunchAssignee;
}) {
  const [isPending, startTransition] = useTransition();

  function toggleCanEdit(nextValue: boolean) {
    startTransition(async () => {
      await setAssignmentCanEdit(projectId, launchId, assignee.assignmentId, nextValue);
    });
  }

  function remove() {
    startTransition(async () => {
      await removeAssignment(projectId, launchId, assignee.assignmentId);
    });
  }

  const showCanEditToggle = assignee.role === "operador";

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-fg">
          {assignee.fullName ?? assignee.email}
        </div>
        <div className="mt-0.5 text-xs text-fg-subtle">
          {assignee.email}
          <span className="mx-2">·</span>
          <span className="uppercase tracking-wide">{assignee.role}</span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        {showCanEditToggle && (
          <label className="flex items-center gap-2 text-xs text-fg-muted">
            <input
              type="checkbox"
              checked={assignee.canEdit}
              disabled={isPending}
              onChange={(e) => toggleCanEdit(e.target.checked)}
              className="accent-accent"
            />
            <span>can_edit</span>
          </label>
        )}
        <button
          type="button"
          onClick={remove}
          disabled={isPending}
          className="text-xs font-medium text-fg-muted hover:text-error disabled:opacity-50"
        >
          {isPending ? "…" : "Quitar"}
        </button>
      </div>
    </li>
  );
}
