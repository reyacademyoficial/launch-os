"use client";

import { useActionState, useTransition } from "react";

import { EmptyState } from "@/components/kg/empty-state";
import {
  ErrorBanner,
  Field,
  inputStyle,
  panelActionPrimaryBtn,
} from "@/components/kg/form-primitives";
import { IconLaunch } from "@/components/kg/icons";
import { Panel } from "@/components/kg/panel";
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
    <Panel title="Países del proyecto">
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <p className="kg-t6" style={{ margin: 0, color: "var(--kg-text-3)" }}>
          Los países se agregan una vez y se reusan en todos los lanzamientos
          del proyecto. Borrar un país elimina también todas sus entradas de
          presupuesto.
        </p>

        <form
          action={formAction}
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "flex-end",
            gap: 12,
          }}
        >
          <div style={{ minWidth: 220, flex: "1 1 220px" }}>
            <Field label="Nuevo país" htmlFor="country-name" required>
              <input
                id="country-name"
                name="name"
                type="text"
                maxLength={80}
                placeholder="ej. Argentina"
                required
                className="kg-focus"
                style={inputStyle}
              />
            </Field>
          </div>
          <button
            type="submit"
            disabled={pending}
            className="kg-focus"
            style={{ ...panelActionPrimaryBtn, opacity: pending ? 0.5 : 1 }}
          >
            {pending ? "Agregando…" : "Agregar"}
          </button>
          {state && "error" in state && (
            <div style={{ flexBasis: "100%" }}>
              <ErrorBanner message={state.error} />
            </div>
          )}
        </form>

        {countries.length === 0 ? (
          <EmptyState
            icon={<IconLaunch size={18} />}
            title="Todavía no hay países cargados"
            hint="Agregá el primero acá arriba para empezar a asignar presupuesto por etapa."
          />
        ) : (
          <ul
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              listStyle: "none",
              margin: 0,
              padding: 0,
            }}
          >
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
    </Panel>
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
    <li
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 10px",
        borderRadius: 999,
        background: "var(--kg-surface-2-solid)",
        border: "1px solid var(--kg-border-subtle)",
        color: "var(--kg-text-1)",
        fontSize: 12,
        fontWeight: 600,
        opacity: pending ? 0.5 : 1,
      }}
    >
      <span>{country.name}</span>
      <button
        type="button"
        onClick={handleDelete}
        disabled={pending}
        aria-label={`Borrar ${country.name}`}
        className="kg-focus"
        style={{
          background: "none",
          border: "none",
          padding: 0,
          lineHeight: 1,
          // El chip es neutro; el rojo vive SÓLO en la acción destructiva.
          color: "var(--kg-negative-500)",
          cursor: pending ? "wait" : "pointer",
          fontSize: 14,
          fontWeight: 700,
        }}
      >
        ×
      </button>
    </li>
  );
}
