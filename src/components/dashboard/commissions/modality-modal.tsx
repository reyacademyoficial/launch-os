"use client";

import { useState } from "react";

import type { CommissionActionState } from "@/app/(app)/proyectos/[projectId]/comisiones/actions";
import { Button } from "@/components/ui/button";
import type { PaymentModalityRow } from "@/lib/commissions/types";

import { ModalityForm } from "./modality-form";

type FormAction = (
  prev: CommissionActionState,
  formData: FormData,
) => Promise<CommissionActionState>;

export function ModalityModal({
  triggerLabel,
  triggerVariant = "primary",
  triggerClassName,
  title,
  submitLabel,
  action,
  initial,
}: {
  readonly triggerLabel: string;
  readonly triggerVariant?: "primary" | "secondary";
  readonly triggerClassName?: string;
  readonly title: string;
  readonly submitLabel: string;
  readonly action: FormAction;
  readonly initial?: PaymentModalityRow;
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
              <ModalityForm
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
