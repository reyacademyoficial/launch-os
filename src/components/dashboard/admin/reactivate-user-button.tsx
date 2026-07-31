"use client";

import { useTransition } from "react";

export function ReactivateUserButton({
  onConfirm,
}: {
  readonly onConfirm: () => Promise<void>;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      onClick={() =>
        startTransition(async () => {
          await onConfirm();
        })
      }
      disabled={isPending}
      className="text-xs font-medium text-accent hover:opacity-80 disabled:opacity-50"
    >
      {isPending ? "Reactivando…" : "Reactivar"}
    </button>
  );
}
