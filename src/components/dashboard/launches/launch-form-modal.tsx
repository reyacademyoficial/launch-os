"use client";

import { useState } from "react";

import type { LaunchActionState } from "@/app/(app)/proyectos/[projectId]/launches/actions";
import { Button } from "@/components/ui/button";
import type { LaunchRow } from "@/lib/launches/types";

import { LaunchForm } from "./launch-form";

type FormAction = (
  prev: LaunchActionState,
  formData: FormData,
) => Promise<LaunchActionState>;

/**
 * Modal envoltorio para crear / editar un launch. El form interno es el mismo
 * `LaunchForm` que renderizaban `/new` y `/edit` (esas rutas siguen vivas como
 * fallback para deep-link). Acá lo metemos en un contenedor con altura fija
 * (`max-h-[90vh]`) y scroll interno para que la sección Calendario y todos los
 * channel/lifecycle fields se vean sin scroll de página.
 *
 * No cierro el modal al éxito desde JS — el server action hace `redirect()`
 * después del INSERT/UPDATE, así el navegador navega y el modal desaparece
 * con la página. Si hay error, `LaunchForm` lo muestra inline y el modal queda
 * abierto.
 */
export function LaunchFormModal({
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
  readonly initial?: LaunchRow;
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
          aria-labelledby="launch-form-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 sm:p-6"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-md border border-border bg-bg-elevated shadow-card">
            <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
              <h3
                id="launch-form-modal-title"
                className="text-lg font-bold text-fg"
              >
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
              <LaunchForm
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
