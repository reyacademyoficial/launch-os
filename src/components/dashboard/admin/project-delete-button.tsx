"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

const CONFIRM_WORD = "DELETE";

/**
 * Type-DELETE-to-confirm modal for project deletion.
 *
 * Higher stakes than the launch-level delete because of cascading consequences:
 * removing a project removes every launch, every launch_daily, every
 * project_integration, every project_secrets row, every project_members
 * assignment, and every audit_log entry for that project. There is no undo.
 */
export function ProjectDeleteButton({
  projectName,
  onConfirm,
}: {
  readonly projectName: string;
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
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-medium text-fg-muted hover:text-error"
      >
        Borrar
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-project-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isPending) close();
          }}
        >
          <div className="w-full max-w-md rounded-md border border-border bg-bg-elevated p-6 shadow-card">
            <h3 id="delete-project-title" className="text-lg font-bold text-error">
              Borrar proyecto
            </h3>
            <p className="mt-2 text-sm text-fg-muted">
              Vas a borrar <strong className="text-fg">{projectName}</strong>.
            </p>
            <p className="mt-2 rounded-md border border-error/40 bg-error/10 p-3 text-xs text-error">
              Esto borra <strong>en cascada</strong> todos sus lanzamientos, datos
              diarios, integraciones, credenciales, asignaciones de usuarios y
              audit log. No se puede deshacer.
            </p>
            <p className="mt-4 text-sm text-fg-muted">
              Escribí{" "}
              <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-fg">
                {CONFIRM_WORD}
              </code>{" "}
              para confirmar:
            </p>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              autoFocus
              autoComplete="off"
              className="mt-2 w-full rounded-md border border-border bg-input px-3 py-2 text-center font-mono text-sm tracking-widest text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent"
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
