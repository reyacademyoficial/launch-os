"use client";

import { useActionState, useEffect, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { fmtPercent } from "@/lib/format";
import type { BudgetStage } from "@/lib/budget/types";

import {
  deleteBudgetEntry,
  upsertBudgetEntry,
  type BudgetActionState,
} from "./actions";

/**
 * Fila editable de una entrada. Click en "Editar" convierte la celda "Monto"
 * en input inline; "Guardar" hace upsert (idempotente por unique). "Borrar"
 * pide confirm.
 */
export function EntryRow({
  projectId,
  launchId,
  entry,
  countryName,
  currency,
  total,
}: {
  readonly projectId: string;
  readonly launchId: string;
  readonly entry: {
    id: string;
    stage: BudgetStage;
    country_id: string;
    amount: number;
  };
  readonly countryName: string;
  readonly currency: string;
  readonly total: number;
}) {
  const [editing, setEditing] = useState(false);
  const [deletePending, startDelete] = useTransition();

  const upsertAction = upsertBudgetEntry.bind(null, projectId, launchId);
  const [state, formAction, savePending] = useActionState<
    BudgetActionState,
    FormData
  >(upsertAction, null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (state && "ok" in state) setEditing(false);
  }, [state]);

  const percent = total > 0 ? (entry.amount / total) * 100 : 0;

  function handleDelete() {
    if (!window.confirm(`Borrar el presupuesto de ${countryName}?`)) return;
    startDelete(async () => {
      await deleteBudgetEntry(projectId, launchId, entry.id);
    });
  }

  return (
    <tr className="border-t border-border transition-colors hover:bg-bg-elevated">
      <td className="px-4 py-2 font-medium text-fg">{countryName}</td>
      <td className="px-4 py-2 text-right text-fg-muted">
        {editing ? (
          <form action={formAction} className="flex items-center justify-end gap-2">
            <input type="hidden" name="stage" value={entry.stage} />
            <input type="hidden" name="country_id" value={entry.country_id} />
            <Input
              name="amount"
              type="number"
              min={0}
              step="0.01"
              defaultValue={entry.amount}
              required
              className="w-32 text-right"
              autoFocus
            />
            <Button type="submit" disabled={savePending} className="px-2 py-1 text-xs">
              {savePending ? "…" : "Guardar"}
            </Button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-fg-muted hover:bg-bg-elevated"
            >
              Cancelar
            </button>
            {state && "error" in state && (
              <span className="ml-2">
                <FieldError>{state.error}</FieldError>
              </span>
            )}
          </form>
        ) : (
          <span>
            {currency} {formatAmount(entry.amount)}
          </span>
        )}
      </td>
      <td className="px-4 py-2 text-right text-fg-muted">{fmtPercent(percent)}</td>
      <td className="px-4 py-2 text-right">
        {!editing && (
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium text-fg-muted transition-colors hover:bg-bg-elevated hover:text-fg"
            >
              Editar
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deletePending}
              className="rounded-md border border-error/40 bg-surface px-2 py-1 text-xs font-medium text-error transition-colors hover:bg-error/10 disabled:opacity-50"
            >
              Borrar
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

function formatAmount(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
