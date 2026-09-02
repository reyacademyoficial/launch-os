"use client";

import { useState, useTransition } from "react";

import { dangerBtn, smallBtn } from "@/components/kg/form-primitives";

/**
 * Inline two-step delete for a daily row. Lighter than the launch-level
 * type-DELETE modal: a daily row is cheap to recreate, type-to-confirm would
 * be overkill UX.
 *
 * Click once → toggles into a Cancelar / Confirmar pair.
 * Click Confirmar → fires the bound Server Action; revalidatePath inside the
 * action causes the parent page to re-render with the row gone.
 *
 * NO se migra a `KgConfirmDialog` a propósito: la cabecera de esa primitiva
 * declara este caso fuera de alcance (es un two-step INLINE, no un diálogo
 * modal). Acá sólo cambian los estilos — tokens viejos (`text-fg-muted`,
 * `text-error`) por `smallBtn` / `dangerBtn` de `form-primitives`. El
 * comportamiento y el árbol de estados quedan idénticos.
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
      <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={isPending}
          className="kg-focus"
          style={{ ...smallBtn, opacity: isPending ? 0.5 : 1 }}
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
          className="kg-focus"
          style={{ ...dangerBtn, opacity: isPending ? 0.5 : 1 }}
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
      className="kg-focus"
      style={smallBtn}
    >
      Borrar
    </button>
  );
}
