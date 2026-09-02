"use client";

import { useActionState, useEffect, useState } from "react";

import type { DailyActionState } from "@/app/(app)/(kg)/proyectos/[projectId]/launches/[launchId]/daily-actions";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CHANNEL_LABELS, DAILY_CHANNELS } from "@/lib/launch-daily/types";
import type { LaunchDailyRow } from "@/lib/launch-daily/types";

type FormAction = (
  prev: DailyActionState,
  formData: FormData,
) => Promise<DailyActionState>;

/**
 * Reusable add/edit modal for daily entries. Closes itself on success — the
 * parent page revalidates, so the table and chart refresh without a router
 * round-trip from this component.
 */
export function DailyFormModal({
  triggerLabel,
  triggerClassName,
  triggerVariant = "primary",
  title,
  submitLabel,
  action,
  initial,
}: {
  readonly triggerLabel: string;
  readonly triggerClassName?: string;
  readonly triggerVariant?: "primary" | "secondary";
  readonly title: string;
  readonly submitLabel: string;
  readonly action: FormAction;
  readonly initial?: LaunchDailyRow;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<DailyActionState, FormData>(
    action,
    null,
  );

  useEffect(() => {
    // Close modal when the action returns ok. Reacting to action state is the
    // canonical case for setState inside useEffect; the lint rule's heuristic
    // is being overly strict here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (state && "ok" in state && state.ok) setOpen(false);
  }, [state]);

  function close() {
    if (!pending) setOpen(false);
  }

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
          aria-labelledby="daily-form-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="w-full max-w-lg rounded-md border border-border bg-bg-elevated p-6 shadow-card">
            <header className="mb-4 flex items-center justify-between">
              <h3 id="daily-form-title" className="text-lg font-bold text-fg">
                {title}
              </h3>
              <button
                type="button"
                onClick={close}
                disabled={pending}
                aria-label="Cerrar"
                className="text-fg-subtle hover:text-fg"
              >
                ×
              </button>
            </header>

            <form action={formAction} className="space-y-4">
              <div>
                <Label htmlFor="daily-date">Fecha *</Label>
                <Input
                  id="daily-date"
                  name="date"
                  type="date"
                  required
                  defaultValue={initial?.date ?? ""}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                {DAILY_CHANNELS.map((ch) => (
                  <div key={ch}>
                    <Label htmlFor={`daily-${ch}`}>{CHANNEL_LABELS[ch]}</Label>
                    <Input
                      id={`daily-${ch}`}
                      name={ch}
                      type="number"
                      min="0"
                      step="1"
                      placeholder="0"
                      defaultValue={initial ? String(initial[ch]) : ""}
                    />
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={close}
                  disabled={pending}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? "Guardando…" : submitLabel}
                </Button>
              </div>

              {state && "error" in state && <FieldError>{state.error}</FieldError>}
            </form>
          </div>
        </div>
      )}
    </>
  );
}
