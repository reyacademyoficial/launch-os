"use client";

import { useState, useTransition } from "react";

/**
 * Inline two-step confirm for soft-deleting a user.
 *
 * Reversible (the row stays; can be undone from Studio by clearing
 * `profiles.deleted_at` and calling `auth.admin.updateUserById({ ban_duration: 'none' })`),
 * so we don't use the heavier type-DELETE modal.
 */
export function DeactivateUserButton({
  onConfirm,
}: {
  readonly onConfirm: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (confirming) {
    return (
      <div className="inline-flex items-center gap-3 text-xs">
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
          {isPending ? "Desactivando…" : "Confirmar"}
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="text-xs font-medium text-fg-muted hover:text-error"
    >
      Desactivar
    </button>
  );
}
