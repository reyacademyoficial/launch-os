"use client";

import { useTransition } from "react";

import { deleteAlertRule, toggleAlertRule } from "./actions";

/**
 * Acciones inline por fila: activar/desactivar + borrar. Usan transiciones
 * para mostrar pending y evitar doble-click. El borrado pide confirmación
 * básica con `window.confirm` — suficiente para una operación reversible
 * (solo desactiva los disparos, no hay datos huérfanos).
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

  function handleToggle() {
    startTransition(async () => {
      await toggleAlertRule(projectId, launchId, ruleId, !active);
    });
  }

  function handleDelete() {
    if (!window.confirm("¿Borrar esta regla?")) return;
    startTransition(async () => {
      await deleteAlertRule(projectId, launchId, ruleId);
    });
  }

  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={handleToggle}
        disabled={pending}
        className="rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium text-fg-muted transition-colors hover:bg-bg-elevated hover:text-fg disabled:opacity-50"
      >
        {active ? "Desactivar" : "Activar"}
      </button>
      <button
        type="button"
        onClick={handleDelete}
        disabled={pending}
        className="rounded-md border border-error/40 bg-surface px-2 py-1 text-xs font-medium text-error transition-colors hover:bg-error/10 disabled:opacity-50"
      >
        Borrar
      </button>
    </div>
  );
}
