"use client";

import { useOptimistic, useState, useTransition, type DragEvent } from "react";

import type { LeadActionState } from "@/app/(app)/proyectos/[projectId]/leads/actions";
import { LEAD_STATUSES, LEAD_STATUS_LABELS, type LeadRow, type LeadStatus } from "@/lib/leads/types";
import type { TeamMemberRow } from "@/lib/team/types";

import { LeadFormModal } from "./lead-form-modal";

type MoveAction = (
  leadId: string,
  status: LeadStatus,
) => Promise<{ ok: true } | { error: string }>;

type UpdateActionFactory = (
  leadId: string,
) => (prev: LeadActionState, formData: FormData) => Promise<LeadActionState>;

type DeleteActionFactory = (leadId: string) => () => Promise<void>;

/**
 * Tablero kanban del pipeline. Columnas = LEAD_STATUSES, ordenadas según el
 * orden canónico definido en `lib/leads/types`. Drag-and-drop usando HTML5
 * nativo — sin libs externas — porque las cards son livianas y el dataset es
 * chico (un proyecto típico no pasa de ~cientos de leads abiertos).
 *
 * El UPDATE optimista se aplica con `useOptimistic` para que el lead salte de
 * columna sin esperar al server. Si la action falla, React revierte al estado
 * del prop (el siguiente render desde el server pisa el optimistic).
 */
export function KanbanBoard({
  leads,
  teamMembers,
  launches,
  canEdit,
  moveAction,
  updateActionFor,
  deleteActionFor,
}: {
  readonly leads: ReadonlyArray<LeadRow>;
  readonly teamMembers: ReadonlyArray<Pick<TeamMemberRow, "id" | "name" | "active">>;
  readonly launches: ReadonlyArray<{ id: string; name: string }>;
  readonly canEdit: boolean;
  readonly moveAction: MoveAction;
  readonly updateActionFor: UpdateActionFactory;
  readonly deleteActionFor: DeleteActionFactory;
}) {
  const [, startTransition] = useTransition();
  const [dragOverCol, setDragOverCol] = useState<LeadStatus | null>(null);
  const [optimistic, setOptimistic] = useOptimistic(
    leads,
    (current, action: { id: string; status: LeadStatus }) =>
      current.map((l) => (l.id === action.id ? { ...l, status: action.status } : l)),
  );

  const memberById = new Map(teamMembers.map((m) => [m.id, m]));

  function handleDragStart(e: DragEvent<HTMLDivElement>, leadId: string) {
    e.dataTransfer.setData("text/plain", leadId);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>, status: LeadStatus) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverCol !== status) setDragOverCol(status);
  }

  function handleDragLeave(status: LeadStatus) {
    if (dragOverCol === status) setDragOverCol(null);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>, status: LeadStatus) {
    e.preventDefault();
    setDragOverCol(null);
    const leadId = e.dataTransfer.getData("text/plain");
    if (!leadId) return;
    const lead = optimistic.find((l) => l.id === leadId);
    if (!lead || lead.status === status) return;

    startTransition(async () => {
      setOptimistic({ id: leadId, status });
      await moveAction(leadId, status);
    });
  }

  const buckets: Record<LeadStatus, LeadRow[]> = {
    nuevo: [],
    contactado: [],
    calificado: [],
    agendado: [],
    cerrado: [],
    perdido: [],
  };
  for (const lead of optimistic) buckets[lead.status].push(lead);

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {LEAD_STATUSES.map((status) => {
        const items = buckets[status];
        const isDragOver = dragOverCol === status;
        return (
          <div
            key={status}
            onDragOver={canEdit ? (e) => handleDragOver(e, status) : undefined}
            onDragLeave={canEdit ? () => handleDragLeave(status) : undefined}
            onDrop={canEdit ? (e) => handleDrop(e, status) : undefined}
            className={
              "flex w-72 shrink-0 flex-col rounded-md border bg-surface/40 " +
              (isDragOver ? "border-accent bg-accent/5" : "border-border")
            }
          >
            <header className="flex items-baseline justify-between border-b border-border px-3 py-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-fg">
                {LEAD_STATUS_LABELS[status]}
              </h2>
              <span className="text-xs text-fg-subtle">{items.length}</span>
            </header>
            <div className="flex flex-col gap-2 p-2">
              {items.length === 0 ? (
                <p className="px-2 py-6 text-center text-xs text-fg-subtle">
                  Sin leads
                </p>
              ) : (
                items.map((lead) => {
                  const assignee = lead.team_member_id
                    ? memberById.get(lead.team_member_id)
                    : null;
                  return (
                    <div
                      key={lead.id}
                      draggable={canEdit}
                      onDragStart={(e) => handleDragStart(e, lead.id)}
                      className={
                        "rounded-md border border-border bg-bg-elevated p-3 text-sm " +
                        (canEdit ? "cursor-grab active:cursor-grabbing" : "")
                      }
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium text-fg">
                            {lead.name}
                          </div>
                          {lead.contact && (
                            <div className="mt-0.5 truncate text-xs text-fg-muted">
                              {lead.contact}
                            </div>
                          )}
                        </div>
                        {lead.source !== "manual" && (
                          <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium uppercase text-accent">
                            {lead.source}
                          </span>
                        )}
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-fg-subtle">
                        <span className="truncate">
                          {assignee ? assignee.name : "Sin asignar"}
                        </span>
                        {canEdit && (
                          <LeadRowActions
                            lead={lead}
                            teamMembers={teamMembers}
                            launches={launches}
                            updateAction={updateActionFor(lead.id)}
                            deleteAction={deleteActionFor(lead.id)}
                          />
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LeadRowActions({
  lead,
  teamMembers,
  launches,
  updateAction,
  deleteAction,
}: {
  readonly lead: LeadRow;
  readonly teamMembers: ReadonlyArray<Pick<TeamMemberRow, "id" | "name" | "active">>;
  readonly launches: ReadonlyArray<{ id: string; name: string }>;
  readonly updateAction: (
    prev: LeadActionState,
    formData: FormData,
  ) => Promise<LeadActionState>;
  readonly deleteAction: () => Promise<void>;
}) {
  const [isPending, startTransition] = useTransition();
  return (
    <div className="flex items-center gap-1">
      <LeadFormModal
        triggerLabel="✎"
        triggerVariant="secondary"
        triggerClassName="!px-1.5 !py-0.5 !text-xs"
        title={`Editar ${lead.name}`}
        submitLabel="Guardar"
        action={updateAction}
        initial={lead}
        teamMembers={teamMembers}
        launches={launches}
      />
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (!confirm(`¿Borrar lead "${lead.name}"?`)) return;
          startTransition(async () => {
            await deleteAction();
          });
        }}
        aria-label="Borrar lead"
        className="rounded-md border border-border bg-surface px-1.5 py-0.5 text-xs text-error hover:bg-error/10 disabled:opacity-50"
      >
        ×
      </button>
    </div>
  );
}
