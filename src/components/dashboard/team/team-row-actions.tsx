"use client";

import { useTransition } from "react";

import { TeamMemberModal } from "./team-member-modal";
import type { TeamActionState } from "@/app/(app)/proyectos/[projectId]/equipo/actions";
import type { TeamMemberRow } from "@/lib/team/types";

type UpdateAction = (
  prev: TeamActionState,
  formData: FormData,
) => Promise<TeamActionState>;

/**
 * Acciones por fila en la tabla de team_members: Editar (modal) + Borrar.
 * El delete es un confirm() simple porque la pérdida es menor (los leads y
 * ventas que apuntaban al miembro mantienen team_member_id = null vía ON
 * DELETE SET NULL).
 */
export function TeamRowActions({
  member,
  updateAction,
  deleteAction,
}: {
  readonly member: TeamMemberRow;
  readonly updateAction: UpdateAction;
  readonly deleteAction: () => Promise<void>;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex items-center justify-end gap-2">
      <TeamMemberModal
        triggerLabel="Editar"
        triggerVariant="secondary"
        triggerClassName="!px-2 !py-1 !text-xs"
        title={`Editar ${member.name}`}
        submitLabel="Guardar"
        action={updateAction}
        initial={member}
      />
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (!confirm(`¿Borrar ${member.name}?`)) return;
          startTransition(async () => {
            await deleteAction();
          });
        }}
        className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-error hover:bg-error/10 disabled:opacity-50"
      >
        {isPending ? "Borrando…" : "Borrar"}
      </button>
    </div>
  );
}
