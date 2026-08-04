"use client";

import { useActionState, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { updatePerson, type UpdatePersonState } from "./actions";

interface EditablePerson {
  readonly id: string;
  readonly full_name: string;
  readonly national_id: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly notes: string | null;
  readonly monthly_salary: number;
  readonly salary_currency: "ARS" | "USD";
}

export function EditPersonModal({ person }: { readonly person: EditablePerson }) {
  const [open, setOpen] = useState(false);
  const boundAction = updatePerson.bind(null, person.id);
  const [state, formAction, pending] = useActionState<UpdatePersonState, FormData>(
    boundAction,
    null,
  );

  useEffect(() => {
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
        className="text-xs font-medium text-fg-muted hover:text-fg"
      >
        Editar
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-person-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="w-full max-w-lg rounded-md border border-border bg-bg-elevated p-6 shadow-card">
            <header className="mb-4 flex items-start justify-between">
              <div>
                <h3 id="edit-person-title" className="text-lg font-bold text-fg">
                  Editar persona
                </h3>
                <p className="mt-1 text-xs text-fg-muted">{person.full_name}</p>
              </div>
              <button
                type="button"
                onClick={close}
                disabled={pending}
                aria-label="Cerrar"
                className="text-fg-subtle hover:text-fg"
              >
                ×
              </button>
            </header>

            <form action={formAction} className="space-y-4">
              <div>
                <Label htmlFor="edit-full_name">Nombre completo</Label>
                <Input
                  id="edit-full_name"
                  name="full_name"
                  type="text"
                  required
                  autoComplete="off"
                  defaultValue={person.full_name}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="edit-national_id">Documento</Label>
                  <Input
                    id="edit-national_id"
                    name="national_id"
                    type="text"
                    autoComplete="off"
                    defaultValue={person.national_id ?? ""}
                    placeholder="CUIT / DNI / tax id"
                  />
                </div>
                <div>
                  <Label htmlFor="edit-phone">Teléfono</Label>
                  <Input
                    id="edit-phone"
                    name="phone"
                    type="tel"
                    autoComplete="off"
                    defaultValue={person.phone ?? ""}
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="edit-email">Email</Label>
                <Input
                  id="edit-email"
                  name="email"
                  type="email"
                  autoComplete="off"
                  defaultValue={person.email ?? ""}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="edit-monthly_salary">Sueldo mensual</Label>
                  <Input
                    id="edit-monthly_salary"
                    name="monthly_salary"
                    type="number"
                    min={0}
                    step="0.01"
                    autoComplete="off"
                    defaultValue={String(person.monthly_salary)}
                  />
                  <p className="mt-1 text-[10px] text-fg-subtle">
                    Base sugerida al cargar la nómina del mes.
                  </p>
                </div>
                <div>
                  <Label htmlFor="edit-salary_currency">Moneda</Label>
                  <select
                    id="edit-salary_currency"
                    name="salary_currency"
                    defaultValue={person.salary_currency}
                    className="w-full rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-fg"
                  >
                    <option value="ARS">ARS</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
              </div>

              <div>
                <Label htmlFor="edit-notes">Notas</Label>
                <Input
                  id="edit-notes"
                  name="notes"
                  type="text"
                  autoComplete="off"
                  defaultValue={person.notes ?? ""}
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={close}
                  disabled={pending}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? "Guardando…" : "Guardar"}
                </Button>
              </div>

              {state && "error" in state && <FieldError>{state.error}</FieldError>}
            </form>
          </div>
        </div>
      )}
    </>
  );
}
