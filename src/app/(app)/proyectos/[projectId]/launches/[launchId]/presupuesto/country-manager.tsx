"use client";

import { useActionState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { BudgetCountryRow } from "@/lib/budget/types";

import {
  addBudgetCountry,
  deleteBudgetCountry,
  type BudgetActionState,
} from "./actions";

/**
 * Gestor del catálogo de países del proyecto. Add-form arriba + chips
 * borrables abajo. Borrar un país cascadea a TODAS las entries del proyecto
 * (todos los launches) — el confirm lo explicita.
 */
export function CountryManager({
  projectId,
  launchId,
  countries,
}: {
  readonly projectId: string;
  readonly launchId: string;
  readonly countries: ReadonlyArray<BudgetCountryRow>;
}) {
  const action = addBudgetCountry.bind(null, projectId, launchId);
  const [state, formAction, pending] = useActionState<BudgetActionState, FormData>(
    action,
    null,
  );

  return (
    <div className="space-y-3 rounded-md border border-border bg-surface p-4">
      <div>
        <h3 className="text-sm font-semibold text-fg">Países del proyecto</h3>
        <p className="text-xs text-fg-subtle">
          Los países se agregan una vez y se reusan en todos los lanzamientos del
          proyecto. Borrar un país elimina también todas sus entradas de
          presupuesto.
        </p>
      </div>

      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <Label htmlFor="country-name">Nuevo país</Label>
          <Input
            id="country-name"
            name="name"
            type="text"
            maxLength={80}
            placeholder="ej. Argentina"
            required
          />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Agregando…" : "Agregar"}
        </Button>
        {state && "error" in state && <FieldError>{state.error}</FieldError>}
      </form>

      {countries.length === 0 ? (
        <p className="text-sm text-fg-muted">
          Todavía no hay países cargados. Agregá el primero para empezar a
          asignar presupuesto.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2 pt-2">
          {countries.map((c) => (
            <CountryChip
              key={c.id}
              projectId={projectId}
              launchId={launchId}
              country={c}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function CountryChip({
  projectId,
  launchId,
  country,
}: {
  readonly projectId: string;
  readonly launchId: string;
  readonly country: BudgetCountryRow;
}) {
  const [pending, startTransition] = useTransition();

  function handleDelete() {
    const ok = window.confirm(
      `Borrar "${country.name}" de la lista? Se eliminan también todas las entradas de presupuesto asociadas en este proyecto.`,
    );
    if (!ok) return;
    startTransition(async () => {
      await deleteBudgetCountry(projectId, launchId, country.id);
    });
  }

  return (
    <li className="inline-flex items-center gap-2 rounded-md border border-border bg-bg-elevated px-2 py-1 text-xs text-fg">
      <span>{country.name}</span>
      <button
        type="button"
        onClick={handleDelete}
        disabled={pending}
        aria-label={`Borrar ${country.name}`}
        className="text-error hover:text-error/80 disabled:opacity-50"
      >
        ×
      </button>
    </li>
  );
}
