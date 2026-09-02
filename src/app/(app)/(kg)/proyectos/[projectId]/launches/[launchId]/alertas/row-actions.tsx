"use client";

import { useState, useTransition } from "react";

import { KgConfirmDialog } from "@/components/kg/confirm-dialog";
import { dangerBtn, smallBtn } from "@/components/kg/form-primitives";

import { deleteAlertRule, toggleAlertRule } from "./actions";

/**
 * Acciones inline por fila: activar/desactivar + borrar. Usan transiciones
 * para mostrar pending y evitar doble-click.
 *
 * MIGRACIÓN KG
 * El borrado pedía confirmación con `window.confirm()`, que no se puede
 * estilar, ignora el tema claro/oscuro y bloquea el hilo. Pasa a
 * `KgConfirmDialog` — el propio componente documenta este archivo como uno
 * de sus casos de reemplazo. SIN `confirmWord`: borrar una regla de alerta es
 * barato y reversible (deja de disparar, no borra datos históricos), así que
 * el type-to-confirm sería fricción injustificada.
 *
 * El `pending` del `useTransition` se le pasa al diálogo para que no se pueda
 * cerrar ni re-disparar mientras la Server Action corre.
 */
export function AlertRuleRowActions({
  projectId,
  launchId,
  ruleId,
  active,
}: {
  readonly projectId: string;
  readonly launchId: string;
  readonly ruleId: string;
  readonly active: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [askDelete, setAskDelete] = useState(false);

  function handleToggle() {
    startTransition(async () => {
      await toggleAlertRule(projectId, launchId, ruleId, !active);
    });
  }

  function handleDelete() {
    startTransition(async () => {
      await deleteAlertRule(projectId, launchId, ruleId);
      setAskDelete(false);
    });
  }

  return (
    <div
      style={{
        display: "inline-flex",
        gap: 8,
        justifyContent: "flex-end",
        flexWrap: "wrap",
      }}
    >
      <button
        type="button"
        onClick={handleToggle}
        disabled={pending}
        className="kg-focus"
        style={{
          ...smallBtn,
          opacity: pending ? 0.5 : 1,
          cursor: pending ? "not-allowed" : "pointer",
        }}
      >
        {active ? "Desactivar" : "Activar"}
      </button>
      <button
        type="button"
        onClick={() => setAskDelete(true)}
        disabled={pending}
        className="kg-focus"
        style={{
          ...dangerBtn,
          padding: "6px 10px",
          opacity: pending ? 0.5 : 1,
          cursor: pending ? "not-allowed" : "pointer",
        }}
      >
        Borrar
      </button>

      <KgConfirmDialog
        open={askDelete}
        onClose={() => setAskDelete(false)}
        title="Borrar regla"
        description="La regla deja de disparar. No se pierden datos históricos."
        confirmLabel="Borrar"
        pendingLabel="Borrando…"
        pending={pending}
        onConfirm={handleDelete}
      />
    </div>
  );
}
