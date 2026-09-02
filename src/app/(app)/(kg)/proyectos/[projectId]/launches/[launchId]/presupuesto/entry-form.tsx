"use client";

import { useActionState, useRef, useEffect } from "react";

import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { BudgetCountryRow, BudgetStage } from "@/lib/budget/types";

import { upsertBudgetEntry, type BudgetActionState } from "./actions";

/**
 * Form inline al pie de cada tabla de etapa. Elegís país (de los que no
 * tenés todavía cargados en esta etapa) + monto. Al éxito, el input se
 * resetea para agregar otro sin recargar.
 *
 * Si no hay países disponibles (todos ya cargados o el catálogo está vacío)
 * el form no se renderiza — el mensaje lo maneja el padre.
 */
export function EntryForm({
  projectId,
  launchId,
  stage,
  availableCountries,
}: {
  readonly projectId: string;
  readonly launchId: string;
  readonly stage: BudgetStage;
  readonly availableCountries: ReadonlyArray<BudgetCountryRow>;
}) {
  const action = upsertBudgetEntry.bind(null, projectId, launchId);
  const [state, formAction, pending] = useActionState<BudgetActionState, FormData>(
    action,
    null,
  );

  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state && "ok" in state) formRef.current?.reset();
  }, [state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="flex flex-wrap items-end gap-2 border-t border-border bg-bg-elevated px-4 py-3"
    >
      <input type="hidden" name="stage" value={stage} />
      <div className="min-w-[180px]">
        <Select name="country_id" required defaultValue="">
          <option value="" disabled>
            Elegir país…
          </option>
          {availableCountries.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="min-w-[140px]">
        <Input
          name="amount"
          type="number"
          min={0}
          step="0.01"
          placeholder="Monto"
          required
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Guardando…" : "Agregar"}
      </Button>
      {state && "error" in state && <FieldError>{state.error}</FieldError>}
    </form>
  );
}
