"use client";

import { useState, useTransition } from "react";

import { KgConfirmDialog } from "@/components/kg/confirm-dialog";
import { dangerBtn } from "@/components/kg/form-primitives";

/**
 * Palabra del type-to-confirm. Se sigue declarando acá porque es parte del
 * contrato de ESTA acción (borrar un lanzamiento entero es irreversible), no
 * del diálogo: `KgConfirmDialog` la recibe por `confirmWord` y sólo habilita
 * el botón destructivo cuando el input coincide exacto.
 */
const CONFIRM_WORD = "DELETE";

/**
 * Borrar lanzamiento, con confirmación type-to-confirm.
 *
 * QUÉ CAMBIÓ EN LA MIGRACIÓN KG
 * Este archivo montaba su propio overlay `fixed inset-0 z-[2100]` con caja,
 * input y dos botones — ~60 LOC de chrome duplicado sobre tokens viejos
 * (`bg-bg-elevated`, `border-border`, `text-fg`, `focus:ring-accent`). Todo
 * eso es ahora `KgConfirmDialog`, que documenta en su cabecera por qué es un
 * overlay propio y no un `Drawer`: el 2100 salió justamente de acá, así que
 * el apilado sobre el `KgBottomSheet` (2000) del kebab mobile se conserva —
 * ahora con nombre (`KG_Z_CONFIRM`) en vez de un literal suelto.
 *
 * El diálogo también agrega lo que este modal no tenía: trampa de foco,
 * restitución del foco al cerrar, `stopPropagation` del Esc (para no cerrar
 * el sheet de abajo de un saque) y bloqueo del cierre mientras la acción
 * corre.
 *
 * POR QUÉ SE MANTIENE `useTransition`
 * `KgConfirmDialog` sabe entrar solo en pending si `onConfirm` devuelve una
 * Promise, pero acá el Server Action navega/revalida: envolverlo en una
 * transition es lo que mantiene la UI responsiva durante el re-render del
 * árbol. Se le pasa el `pending` externo (el diálogo lo OR-ea con el suyo).
 *
 * El Server Action hace su propio `requireCanEditProject`; este componente es
 * sólo UX.
 */
export function DeleteButton({
  launchName,
  onConfirm,
  fullWidth = false,
}: {
  readonly launchName: string;
  readonly onConfirm: () => Promise<void>;
  /**
   * En el bottom-sheet mobile las acciones son filas full width. Sin esto el
   * disparador quedaba como una pastilla suelta a la izquierda, desalineada
   * con "Duplicar" / "Cerrar lanzamiento".
   */
  readonly fullWidth?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="kg-focus"
        style={
          fullWidth
            ? { ...dangerBtn, width: "100%", padding: "11px 14px", fontSize: 13 }
            : dangerBtn
        }
      >
        Borrar
      </button>

      <KgConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Borrar lanzamiento"
        description={
          <>
            Vas a borrar{" "}
            <b style={{ color: "var(--kg-text-1)" }}>{launchName}</b>. Esta
            acción no se puede deshacer.
          </>
        }
        confirmWord={CONFIRM_WORD}
        confirmLabel="Borrar definitivamente"
        pendingLabel="Borrando…"
        pending={isPending}
        onConfirm={() => {
          startTransition(async () => {
            await onConfirm();
          });
        }}
      />
    </>
  );
}
