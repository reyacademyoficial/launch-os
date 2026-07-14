"use client";

import { useState, useTransition } from "react";

/**
 * Botón de borrado con manejo de FK-restrict (SQLSTATE 23503 cuando hay
 * cobros asociados). Mismo patrón que ProductDelete.
 */
export function PaymentMethodDelete({
  name,
  action,
}: {
  readonly name: string;
  readonly action: () => Promise<{ ok: true } | { error: string }>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (!confirm(`¿Borrar "${name}"? Se sale del catálogo permanentemente.`)) {
            return;
          }
          setError(null);
          startTransition(async () => {
            const result = await action();
            if ("error" in result) setError(result.error);
          });
        }}
        className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-error hover:bg-error/10 disabled:opacity-50"
      >
        {isPending ? "Borrando…" : "Borrar"}
      </button>
      {error && (
        <span className="max-w-xs text-right text-xs text-error">{error}</span>
      )}
    </div>
  );
}
