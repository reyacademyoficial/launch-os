"use client";

import { useActionState, useEffect, useRef, useTransition } from "react";

import {
  dangerBtn,
  ErrorBanner,
  inputStyle,
  smallBtn,
} from "@/components/kg/form-primitives";
import type { BudgetStage } from "@/lib/budget/types";

import {
  deleteBudgetEntry,
  upsertBudgetEntry,
  type BudgetActionState,
} from "./actions";

/**
 * Celdas de la fila editable de una entrada de presupuesto.
 *
 * ── Por qué son DOS componentes y no una fila ─────────────────────────────
 * Esto era un `<tr>` completo (`EntryRow`) con el flag `editing` adentro.
 * Al pasar la tabla a `KgDataTable` los `<tr>`/`<td>` son de la tabla, y cada
 * columna sólo aporta el contenido de SU celda — pero el estado de edición
 * afecta a dos columnas (monto y acciones). Por eso el flag subió a
 * `StageTable` y acá quedan las dos mitades, con el mismo comportamiento:
 * "Editar" abre el input inline, "Guardar" hace el upsert (idempotente por
 * unique) y "Borrar" pide confirm.
 */

export function formatAmount(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function EntryAmountCell({
  projectId,
  launchId,
  entry,
  currency,
  editing,
  onDone,
}: {
  readonly projectId: string;
  readonly launchId: string;
  readonly entry: {
    id: string;
    stage: BudgetStage;
    country_id: string;
    amount: number;
  };
  readonly currency: string;
  readonly editing: boolean;
  /** Se llama cuando el upsert resolvió ok — cierra la edición en el padre. */
  readonly onDone: () => void;
}) {
  const upsertAction = upsertBudgetEntry.bind(null, projectId, launchId);
  const [state, formAction, savePending] = useActionState<
    BudgetActionState,
    FormData
  >(upsertAction, null);

  // El callback viaja por ref para que el efecto dependa SÓLO de `state`. Si
  // dependiera de `onDone` (una arrow nueva en cada render del padre) se
  // volvería a disparar al reabrir la misma fila: `state` sigue en "ok" y la
  // edición se cerraría sola apenas se abre.
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    if (state && "ok" in state) onDoneRef.current();
  }, [state]);

  if (!editing) {
    return (
      <span>
        {currency} {formatAmount(entry.amount)}
      </span>
    );
  }

  return (
    <form
      action={formAction}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: 6,
        flexWrap: "wrap",
      }}
    >
      <input type="hidden" name="stage" value={entry.stage} />
      <input type="hidden" name="country_id" value={entry.country_id} />
      <input
        name="amount"
        type="number"
        min={0}
        step="0.01"
        defaultValue={entry.amount}
        required
        autoFocus
        aria-label="Monto presupuestado"
        className="kg-focus kg-num"
        style={{ ...inputStyle, width: 120, textAlign: "right" }}
      />
      <button
        type="submit"
        disabled={savePending}
        className="kg-focus"
        style={{ ...smallBtn, opacity: savePending ? 0.5 : 1 }}
      >
        {savePending ? "…" : "Guardar"}
      </button>
      <button
        type="button"
        onClick={onDone}
        className="kg-focus"
        style={smallBtn}
      >
        Cancelar
      </button>
      {state && "error" in state && (
        <div style={{ flexBasis: "100%" }}>
          <ErrorBanner message={state.error} />
        </div>
      )}
    </form>
  );
}

export function EntryActionsCell({
  projectId,
  launchId,
  entryId,
  countryName,
  onEdit,
}: {
  readonly projectId: string;
  readonly launchId: string;
  readonly entryId: string;
  readonly countryName: string;
  readonly onEdit: () => void;
}) {
  const [deletePending, startDelete] = useTransition();

  function handleDelete() {
    if (!window.confirm(`Borrar el presupuesto de ${countryName}?`)) return;
    startDelete(async () => {
      await deleteBudgetEntry(projectId, launchId, entryId);
    });
  }

  return (
    <div style={{ display: "inline-flex", justifyContent: "flex-end", gap: 6 }}>
      <button
        type="button"
        onClick={onEdit}
        className="kg-focus"
        style={smallBtn}
      >
        Editar
      </button>
      <button
        type="button"
        onClick={handleDelete}
        disabled={deletePending}
        className="kg-focus"
        style={{ ...dangerBtn, opacity: deletePending ? 0.5 : 1 }}
      >
        Borrar
      </button>
    </div>
  );
}
