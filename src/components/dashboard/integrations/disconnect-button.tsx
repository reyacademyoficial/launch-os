"use client";

import { useState, useTransition } from "react";

/**
 * Inline two-step confirm for disconnecting an integration. Same pattern as
 * the daily-row delete: less ceremonial than the launch-level type-to-confirm
 * modal because reconnect is cheap and the data lost is just the credentials
 * (which the admin presumably has elsewhere).
 */
export function DisconnectButton({
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
          {isPending ? "Desconectando…" : "Confirmar desconexión"}
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
      Desconectar
    </button>
  );
}
