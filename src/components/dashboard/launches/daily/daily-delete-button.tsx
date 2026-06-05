"use client";

import { useState, useTransition } from "react";

/**
 * Inline two-step delete for a daily row. Lighter than the launch-level
 * type-DELETE modal: a daily row is cheap to recreate, type-to-confirm would
 * be overkill UX.
 *
 * Click once → toggles into a Cancelar / Confirmar pair.
 * Click Confirmar → fires the bound Server Action; revalidatePath inside the
 * action causes the parent page to re-render with the row gone.
 */
export function DailyDeleteButton({
  onConfirm,
}: {
  readonly onConfirm: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (confirming) {
    return (
      <div className="inline-flex items-center gap-2 text-xs">
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={isPending}
          className="text-fg-muted hover:text-fg disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={() =>
            startTransition(async () => {
              await onConfirm();
            })
          }
          disabled={isPending}
          className="font-medium text-error hover:opacity-80 disabled:opacity-50"
        >
          {isPending ? "Borrando…" : "Confirmar"}
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="text-xs text-fg-muted hover:text-error"
    >
      Borrar
    </button>
  );
}
