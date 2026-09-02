"use client";

import { useActionState, useEffect, useId, useState } from "react";

import type { DailyActionState } from "@/app/(app)/(kg)/proyectos/[projectId]/launches/[launchId]/daily-actions";
import { Drawer } from "@/components/kg/drawer";
import {
  ErrorBanner,
  Field,
  inputStyle,
  panelActionPrimaryBtn,
  panelActionSecondaryBtn,
  primaryBtn,
  secondaryBtn,
} from "@/components/kg/form-primitives";
import { CHANNEL_LABELS, DAILY_CHANNELS } from "@/lib/launch-daily/types";
import type { LaunchDailyRow } from "@/lib/launch-daily/types";

type FormAction = (
  prev: DailyActionState,
  formData: FormData,
) => Promise<DailyActionState>;

/**
 * Alta/edición de una fila diaria. Cierra solo al éxito — la page padre
 * revalida, así que tabla y chart se refrescan sin round-trip del router.
 *
 * El modal centrado hecho a mano (overlay `bg-black/70` + caja
 * `bg-bg-elevated`, sin Esc, sin foco gestionado) pasó a `Drawer`: panel
 * lateral glass con Esc-to-close y click-outside. El nombre del componente y
 * sus props NO cambian — lo consume el tab KPI, que es de otro agente.
 *
 * Los botones viven en el `footer` del Drawer y se atan al `<form>` del
 * cuerpo por `form={formId}`: así el submit queda fijo abajo aunque el
 * formulario scrollee, sin duplicar el form ni mover el estado.
 */
export function DailyFormModal({
  triggerLabel,
  triggerClassName,
  triggerVariant = "primary",
  title,
  submitLabel,
  action,
  initial,
}: {
  readonly triggerLabel: string;
  readonly triggerClassName?: string;
  readonly triggerVariant?: "primary" | "secondary";
  readonly title: string;
  readonly submitLabel: string;
  readonly action: FormAction;
  readonly initial?: LaunchDailyRow;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<DailyActionState, FormData>(
    action,
    null,
  );
  // `useId()` trae delimitadores (`:r0:` / `«r0»`) que ensucian un id de DOM;
  // se limpian porque este id se referencia desde `form=` del botón submit.
  const formId = `daily-form-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  useEffect(() => {
    // Close modal when the action returns ok. Reacting to action state is the
    // canonical case for setState inside useEffect; the lint rule's heuristic
    // is being overly strict here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (state && "ok" in state && state.ok) setOpen(false);
  }, [state]);

  function close() {
    if (!pending) setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`kg-focus${triggerClassName ? ` ${triggerClassName}` : ""}`}
        style={
          triggerVariant === "primary"
            ? panelActionPrimaryBtn
            : panelActionSecondaryBtn
        }
      >
        {triggerLabel}
      </button>

      <Drawer
        open={open}
        onClose={close}
        title={title}
        subtitle="Leads cargados a mano por canal. Vacío se guarda como 0."
        footer={
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 10,
            }}
          >
            <button
              type="button"
              onClick={close}
              disabled={pending}
              className="kg-focus"
              style={{ ...secondaryBtn, opacity: pending ? 0.5 : 1 }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              form={formId}
              disabled={pending}
              className="kg-focus"
              style={{ ...primaryBtn, opacity: pending ? 0.5 : 1 }}
            >
              {pending ? "Guardando…" : submitLabel}
            </button>
          </div>
        }
      >
        <form
          id={formId}
          action={formAction}
          style={{ display: "flex", flexDirection: "column", gap: 16 }}
        >
          <Field label="Fecha" htmlFor="daily-date" required>
            <input
              id="daily-date"
              name="date"
              type="date"
              required
              defaultValue={initial?.date ?? ""}
              className="kg-focus"
              style={inputStyle}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            {DAILY_CHANNELS.map((ch) => (
              <Field key={ch} label={CHANNEL_LABELS[ch]} htmlFor={`daily-${ch}`}>
                <input
                  id={`daily-${ch}`}
                  name={ch}
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  placeholder="0"
                  defaultValue={initial ? String(initial[ch]) : ""}
                  className="kg-focus kg-num"
                  style={{ ...inputStyle, textAlign: "right" }}
                />
              </Field>
            ))}
          </div>

          {state && "error" in state && <ErrorBanner message={state.error} />}
        </form>
      </Drawer>
    </>
  );
}
