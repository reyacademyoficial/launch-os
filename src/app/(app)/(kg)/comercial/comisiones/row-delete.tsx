"use client";

import { useTransition } from "react";

/**
 * Botón de borrado simple con confirm() para filas de tablas de configuración
 * (modalidades + reglas). Se reusa entre las dos tablas.
 */
export function RowDelete({
  confirmLabel,
  action,
}: {
  readonly confirmLabel: string;
  readonly action: () => Promise<void>;
}) {
  const [isPending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => {
        if (!confirm(confirmLabel)) return;
        startTransition(async () => {
          await action();
        });
      }}
      className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-error hover:bg-error/10 disabled:opacity-50"
    >
      {isPending ? "Borrando…" : "Borrar"}
    </button>
  );
}
