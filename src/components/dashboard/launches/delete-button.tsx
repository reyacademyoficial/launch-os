"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

const CONFIRM_WORD = "DELETE";

/**
 * Type-to-confirm delete dialog, matching the prototype's UX.
 *
 * Takes a bound Server Action as `onConfirm`. The Server Action does its own
 * `requireCanEditProject` check; this component is for UX only.
 */
export function DeleteButton({
  launchName,
  onConfirm,
}: {
  readonly launchName: string;
  readonly onConfirm: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [isPending, startTransition] = useTransition();

  const canConfirm = input === CONFIRM_WORD;

  function close() {
    setOpen(false);
    setInput("");
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        className="!border-error/40 !text-error hover:!bg-error/10"
        onClick={() => setOpen(true)}
      >
        Borrar
      </Button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-launch-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isPending) close();
          }}
        >
          <div className="w-full max-w-md rounded-md border border-border bg-bg-elevated p-6 shadow-card">
            <h3 id="delete-launch-title" className="text-lg font-bold text-fg">
              Borrar lanzamiento
            </h3>
            <p className="mt-2 text-sm text-fg-muted">
              Vas a borrar <strong className="text-fg">{launchName}</strong>. Esta
              acción no se puede deshacer.
            </p>
            <p className="mt-3 text-sm text-fg-muted">
              Escribí <code className="rounded bg-surface px-1.5 py-0.5 text-fg">{CONFIRM_WORD}</code>{" "}
              para confirmar:
            </p>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              autoFocus
              autoComplete="off"
              className="mt-2 w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent"
            />

            <div className="mt-6 flex justify-end gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={close}
                disabled={isPending}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                disabled={!canConfirm || isPending}
                className="!bg-error hover:!opacity-90"
                onClick={() => {
                  startTransition(async () => {
                    await onConfirm();
                  });
                }}
              >
                {isPending ? "Borrando…" : "Borrar definitivamente"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
