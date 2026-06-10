"use client";

import { useState } from "react";

import type { LeadActionState } from "@/app/(app)/proyectos/[projectId]/leads/actions";
import { Button } from "@/components/ui/button";
import type { LeadRow } from "@/lib/leads/types";
import type { TeamMemberRow } from "@/lib/team/types";

import { LeadForm } from "./lead-form";

type FormAction = (prev: LeadActionState, formData: FormData) => Promise<LeadActionState>;

export function LeadFormModal({
  triggerLabel,
  triggerVariant = "primary",
  triggerClassName,
  title,
  submitLabel,
  action,
  initial,
  teamMembers,
  launches,
}: {
  readonly triggerLabel: string;
  readonly triggerVariant?: "primary" | "secondary";
  readonly triggerClassName?: string;
  readonly title: string;
  readonly submitLabel: string;
  readonly action: FormAction;
  readonly initial?: LeadRow;
  readonly teamMembers: ReadonlyArray<Pick<TeamMemberRow, "id" | "name" | "active">>;
  readonly launches: ReadonlyArray<{ id: string; name: string }>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant={triggerVariant}
        onClick={() => setOpen(true)}
        className={triggerClassName}
      >
        {triggerLabel}
      </Button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="lead-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 sm:p-6"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-md border border-border bg-bg-elevated shadow-card">
            <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
              <h3 id="lead-modal-title" className="text-lg font-bold text-fg">
                {title}
              </h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Cerrar"
                className="text-fg-subtle hover:text-fg"
              >
                ×
              </button>
            </header>
            <div className="flex-1 overflow-y-auto px-6 py-6">
              <LeadForm
                action={action}
                initial={initial}
                submitLabel={submitLabel}
                onSuccess={() => setOpen(false)}
                teamMembers={teamMembers}
                launches={launches}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
