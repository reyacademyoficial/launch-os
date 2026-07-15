"use client";

import { useState, useTransition } from "react";

/**
 * Botón de borrado de banco. Los métodos de pago que apuntaban acá quedan sin
 * banco asignado (on delete set null) y los movimientos van en cascada.
 */
export function BankDelete({
  name,
  linkedMethodsCount,
  movementsCount,
  action,
}: {
  readonly name: string;
  readonly linkedMethodsCount: number;
  readonly movementsCount: number;
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
          const bits: string[] = [];
          if (movementsCount > 0) {
            bits.push(
              `${movementsCount} movimiento${movementsCount === 1 ? "" : "s"} se borra${movementsCount === 1 ? "" : "n"}`,
            );
          }
          if (linkedMethodsCount > 0) {
            bits.push(
              `${linkedMethodsCount} método${linkedMethodsCount === 1 ? "" : "s"} de pago pierde${linkedMethodsCount === 1 ? "" : "n"} el link (los cobros dejan de sumar acá)`,
            );
          }
          const detail = bits.length > 0 ? `\n\n${bits.join("\n")}` : "";
          if (!confirm(`¿Borrar "${name}"?${detail}`)) return;

          setError(null);
          startTransition(async () => {
            const r = await action();
            if ("error" in r) setError(r.error);
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
