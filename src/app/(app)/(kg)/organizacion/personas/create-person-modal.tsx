"use client";

import { useActionState, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { createPerson, type CreatePersonState } from "./actions";

export function CreatePersonModal() {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<CreatePersonState, FormData>(
    createPerson,
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
      <Button type="button" onClick={() => setOpen(true)}>
        + Nueva persona
      </Button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-person-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="w-full max-w-lg rounded-md border border-border bg-bg-elevated p-6 shadow-card">
            <header className="mb-4 flex items-start justify-between">
              <div>
                <h3 id="create-person-title" className="text-lg font-bold text-fg">
                  Nueva persona
                </h3>
                <p className="mt-1 text-xs text-fg-muted">
                  Solo el nombre es obligatorio; el resto se puede completar
                  después. El documento evita duplicados dentro de la organización.
                </p>
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
                <Label htmlFor="create-full_name">Nombre completo</Label>
                <Input
                  id="create-full_name"
                  name="full_name"
                  type="text"
                  required
                  autoComplete="off"
                  placeholder="Ej. Juan Pérez"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="create-national_id">Documento</Label>
                  <Input
                    id="create-national_id"
                    name="national_id"
                    type="text"
                    autoComplete="off"
                    placeholder="CUIT / DNI / tax id"
                  />
                </div>
                <div>
                  <Label htmlFor="create-phone">Teléfono</Label>
                  <Input
                    id="create-phone"
                    name="phone"
                    type="tel"
                    autoComplete="off"
                    placeholder="Opcional"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="create-email">Email</Label>
                <Input
                  id="create-email"
                  name="email"
                  type="email"
                  autoComplete="off"
                  placeholder="Opcional"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="create-monthly_salary">Sueldo mensual</Label>
                  <Input
                    id="create-monthly_salary"
                    name="monthly_salary"
                    type="number"
                    min={0}
                    step="0.01"
                    autoComplete="off"
                    placeholder="0"
                    defaultValue="0"
                  />
                  <p className="mt-1 text-[10px] text-fg-subtle">
                    Se usa como base al cargar la nómina del mes. Los aguinaldos,
                    bonos o descuentos se agregan como extras en cada liquidación.
                  </p>
                </div>
                <div>
                  <Label htmlFor="create-salary_currency">Moneda</Label>
                  <select
                    id="create-salary_currency"
                    name="salary_currency"
                    defaultValue="ARS"
                    className="w-full rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-fg"
                  >
                    <option value="ARS">ARS</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
              </div>

              <div>
                <Label htmlFor="create-notes">Notas</Label>
                <Input
                  id="create-notes"
                  name="notes"
                  type="text"
                  autoComplete="off"
                  placeholder="Rol, referencia, cualquier cosa útil"
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
                  {pending ? "Creando…" : "Crear persona"}
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
