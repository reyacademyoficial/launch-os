"use client";

import { useState, useTransition } from "react";

import { fmtMoney } from "@/lib/format";

export function MovementDelete({
  amount,
  kind,
  action,
}: {
  readonly amount: number;
  readonly kind: "in" | "out";
  readonly action: () => Promise<{ ok: true } | { error: string }>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          const label = kind === "in" ? "entrada" : "salida";
          if (
            !confirm(
              `¿Borrar ${label} de ${fmtMoney(amount)}? El saldo del banco vuelve a lo de antes.`,
            )
          ) {
            return;
          }
          setError(null);
          startTransition(async () => {
            const r = await action();
            if ("error" in r) setError(r.error);
          });
        }}
        aria-label="Borrar movimiento"
        className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-error hover:bg-error/10 disabled:opacity-50"
      >
        {pending ? "…" : "×"}
      </button>
      {error && (
        <span className="max-w-xs text-right text-xs text-error">{error}</span>
      )}
    </div>
  );
}
