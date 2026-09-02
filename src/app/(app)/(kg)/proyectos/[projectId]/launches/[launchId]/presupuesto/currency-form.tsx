"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { COMMON_CURRENCIES } from "@/lib/budget/types";

import { setBudgetCurrency, type BudgetActionState } from "./actions";

/**
 * Setter de la moneda del launch. Dropdown con las monedas comunes + opción
 * "Otra…" que revela un input de 3 letras. Se puede cambiar en cualquier
 * momento pero no convierte montos ya cargados — se muestra warning si ya
 * había una moneda distinta.
 */
export function CurrencyForm({
  projectId,
  launchId,
  currentCurrency,
}: {
  readonly projectId: string;
  readonly launchId: string;
  readonly currentCurrency: string | null;
}) {
  const action = setBudgetCurrency.bind(null, projectId, launchId);
  const [state, formAction, pending] = useActionState<BudgetActionState, FormData>(
    action,
    null,
  );

  const isKnown =
    currentCurrency != null &&
    (COMMON_CURRENCIES as ReadonlyArray<string>).includes(currentCurrency);
  const [choice, setChoice] = useState<string>(
    currentCurrency == null ? "USD" : isKnown ? currentCurrency : "__other__",
  );

  return (
    <form
      action={formAction}
      className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-surface p-4"
    >
      <div className="min-w-[180px]">
        <Label htmlFor="currency-select">Moneda del lanzamiento</Label>
        <Select
          id="currency-select"
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          name={choice === "__other__" ? undefined : "currency"}
        >
          {COMMON_CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
          <option value="__other__">Otra…</option>
        </Select>
      </div>

      {choice === "__other__" && (
        <div className="min-w-[140px]">
          <Label htmlFor="currency-other">Código (3 letras)</Label>
          <Input
            id="currency-other"
            name="currency"
            type="text"
            maxLength={3}
            minLength={3}
            placeholder="ej. GBP"
            required
            className="uppercase"
          />
        </div>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? "Guardando…" : currentCurrency ? "Cambiar" : "Guardar"}
      </Button>

      {currentCurrency && (
        <p className="w-full text-xs text-fg-subtle">
          Actual: <strong className="text-fg">{currentCurrency}</strong>. Cambiar
          la moneda no convierte los montos ya cargados.
        </p>
      )}

      {state && "error" in state && <FieldError>{state.error}</FieldError>}
    </form>
  );
}
