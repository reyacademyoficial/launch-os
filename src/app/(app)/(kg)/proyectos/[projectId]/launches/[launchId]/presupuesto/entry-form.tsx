"use client";

import { useActionState, useRef, useEffect } from "react";

import {
  ErrorBanner,
  Field,
  inputStyle,
  panelActionPrimaryBtn,
} from "@/components/kg/form-primitives";
import type { BudgetCountryRow, BudgetStage } from "@/lib/budget/types";

import { upsertBudgetEntry, type BudgetActionState } from "./actions";

/**
 * Form inline al pie de cada tabla de etapa. Elegís país (de los que no
 * tenés todavía cargados en esta etapa) + monto. Al éxito, el input se
 * resetea para agregar otro sin recargar.
 *
 * Si no hay países disponibles (todos ya cargados o el catálogo está vacío)
 * el form no se renderiza — el mensaje lo maneja el padre.
 *
 * El `<select>` va nativo con `inputStyle` y NO con `KgFilterSelect`: esa
 * primitiva navega a un `href` por opción (filtro por URL), mientras que acá
 * el valor tiene que viajar en el `FormData` de la server action.
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

  const countryId = `budget-country-${stage}`;
  const amountId = `budget-amount-${stage}`;

  return (
    <form
      ref={formRef}
      action={formAction}
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "flex-end",
        gap: 10,
        padding: "14px 20px",
        borderTop: "1px solid var(--kg-border-subtle)",
      }}
    >
      <input type="hidden" name="stage" value={stage} />
      <div style={{ minWidth: 180, flex: "1 1 180px" }}>
        <Field label="País" htmlFor={countryId} required>
          <select
            id={countryId}
            name="country_id"
            required
            defaultValue=""
            className="kg-focus"
            style={{ ...inputStyle, fontWeight: 600, cursor: "pointer" }}
          >
            <option value="" disabled>
              Elegir país…
            </option>
            {availableCountries.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div style={{ minWidth: 140, flex: "0 1 160px" }}>
        <Field label="Monto" htmlFor={amountId} required>
          <input
            id={amountId}
            name="amount"
            type="number"
            min={0}
            step="0.01"
            placeholder="0.00"
            required
            className="kg-focus kg-num"
            style={{ ...inputStyle, textAlign: "right" }}
          />
        </Field>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="kg-focus"
        style={{ ...panelActionPrimaryBtn, opacity: pending ? 0.5 : 1 }}
      >
        {pending ? "Guardando…" : "Agregar"}
      </button>
      {state && "error" in state && (
        <div style={{ flexBasis: "100%" }}>
          <ErrorBanner message={state.error} />
        </div>
      )}
    </form>
  );
}
