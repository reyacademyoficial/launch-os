"use client";

import { useState } from "react";

import type { BankMovementActionState } from "@/app/(app)/proyectos/[projectId]/bancos/actions";
import type { BankMovementRow } from "@/lib/banks/types";

import { MovementForm } from "./movement-form";

type FormAction = (
  prev: BankMovementActionState,
  formData: FormData,
) => Promise<BankMovementActionState>;

export function MovementModal({
  triggerLabel,
  triggerClassName,
  title,
  submitLabel,
  action,
  initial,
}: {
  readonly triggerLabel: string;
  readonly triggerClassName?: string;
  readonly title: string;
  readonly submitLabel: string;
  readonly action: FormAction;
  readonly initial?: BankMovementRow;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          triggerClassName ??
          "rounded-md border border-border bg-surface px-2 py-1 text-xs text-fg hover:bg-bg-elevated"
        }
      >
        {triggerLabel}
      </button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-md border border-border bg-bg-elevated shadow-card">
            <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
              <h3 className="text-lg font-bold text-fg">{title}</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Cerrar"
                className="text-fg-subtle hover:text-fg"
              >
                ×
              </button>
            </header>
            <div className="px-6 py-6">
              <MovementForm
                action={action}
                initial={initial}
                submitLabel={submitLabel}
                onSuccess={() => setOpen(false)}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
