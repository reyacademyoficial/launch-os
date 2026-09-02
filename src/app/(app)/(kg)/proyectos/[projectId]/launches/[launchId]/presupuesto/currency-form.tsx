"use client";

import { useActionState, useState } from "react";

import {
  ErrorBanner,
  Field,
  inputStyle,
  panelActionPrimaryBtn,
} from "@/components/kg/form-primitives";
import { Panel } from "@/components/kg/panel";
import { COMMON_CURRENCIES } from "@/lib/budget/types";

import { setBudgetCurrency, type BudgetActionState } from "./actions";

/**
 * Setter de la moneda del launch. Dropdown con las monedas comunes + opción
 * "Otra…" que revela un input de 3 letras. Se puede cambiar en cualquier
 * momento pero no convierte montos ya cargados — se muestra warning si ya
 * había una moneda distinta.
 *
 * Los dos `<select>`/`<input>` son nativos con `inputStyle`: `KgFilterSelect`
 * navega por `href` y acá el valor tiene que llegar como `FormData` a la
 * server action.
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
    <Panel title="Moneda del lanzamiento">
      <form
        action={formAction}
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-end",
          gap: 12,
        }}
      >
        <div style={{ minWidth: 180, flex: "0 1 220px" }}>
          <Field label="Moneda" htmlFor="currency-select">
            <select
              id="currency-select"
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
              name={choice === "__other__" ? undefined : "currency"}
              className="kg-focus"
              style={{ ...inputStyle, fontWeight: 600, cursor: "pointer" }}
            >
              {COMMON_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              <option value="__other__">Otra…</option>
            </select>
          </Field>
        </div>

        {choice === "__other__" && (
          <div style={{ minWidth: 140, flex: "0 1 160px" }}>
            <Field label="Código (3 letras)" htmlFor="currency-other" required>
              <input
                id="currency-other"
                name="currency"
                type="text"
                maxLength={3}
                minLength={3}
                placeholder="ej. GBP"
                required
                className="kg-focus"
                style={{ ...inputStyle, textTransform: "uppercase" }}
              />
            </Field>
          </div>
        )}

        <button
          type="submit"
          disabled={pending}
          className="kg-focus"
          style={{ ...panelActionPrimaryBtn, opacity: pending ? 0.5 : 1 }}
        >
          {pending ? "Guardando…" : currentCurrency ? "Cambiar" : "Guardar"}
        </button>

        {currentCurrency && (
          <p
            className="kg-t6"
            style={{ margin: 0, flexBasis: "100%", color: "var(--kg-text-3)" }}
          >
            Actual:{" "}
            <strong style={{ color: "var(--kg-text-1)", fontWeight: 700 }}>
              {currentCurrency}
            </strong>
            . Cambiar la moneda no convierte los montos ya cargados.
          </p>
        )}

        {state && "error" in state && (
          <div style={{ flexBasis: "100%" }}>
            <ErrorBanner message={state.error} />
          </div>
        )}
      </form>
    </Panel>
  );
}
