"use client";

import { useActionState, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

import { createUser, type CreateUserState } from "./actions";

interface Project {
  id: string;
  name: string;
}

/**
 * Trigger button + create-user modal. The form is identical to what previously
 * lived inline on `/admin/usuarios`; wrapping it in a modal keeps the page
 * focused on the user list. The Server Action revalidates the page after a
 * successful create, so the table reflects the new row when the modal closes.
 */
export function CreateUserModal({
  projects,
}: {
  readonly projects: readonly Project[];
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<CreateUserState, FormData>(
    createUser,
    null,
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (state && "ok" in state && state.ok) setOpen(false);
  }, [state]);

  function close() {
    if (!pending) setOpen(false);
  }

  const noProjects = projects.length === 0;

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)} disabled={noProjects}>
        + Crear usuario
      </Button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-user-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="w-full max-w-lg rounded-md border border-border bg-bg-elevated p-6 shadow-card">
            <header className="mb-4 flex items-start justify-between">
              <div>
                <h3 id="create-user-title" className="text-lg font-bold text-fg">
                  Crear usuario
                </h3>
                <p className="mt-1 text-xs text-fg-muted">
                  El usuario queda activo de inmediato. Pasale email + contraseña
                  por un canal seguro; después puede cambiarla en{" "}
                  <code>/configuracion</code>.
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
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="off"
                  placeholder="usuario@empresa.com"
                />
              </div>
              <div>
                <Label htmlFor="full_name">Nombre completo</Label>
                <Input
                  id="full_name"
                  name="full_name"
                  type="text"
                  autoComplete="off"
                  placeholder="Opcional"
                />
              </div>
              <div>
                <Label htmlFor="password">Contraseña inicial</Label>
                <Input
                  id="password"
                  name="password"
                  type="text"
                  required
                  minLength={8}
                  autoComplete="off"
                  placeholder="Mínimo 8 caracteres. El usuario puede cambiarla después."
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="role">Rol</Label>
                  <Select id="role" name="role" required defaultValue="cliente">
                    <option value="cliente">cliente (solo lectura, scope por launch)</option>
                    <option value="operador">operador (edita launches asignados)</option>
                    <option value="coordinador">coordinador (clientes + academia + ops propias)</option>
                    <option value="admin">admin (lectura + escritura del proyecto)</option>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="project_id">Proyecto</Label>
                  <Select id="project_id" name="project_id" required defaultValue="">
                    <option value="" disabled>
                      Elegí uno…
                    </option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </div>
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
                  {pending ? "Creando…" : "Crear usuario"}
                </Button>
              </div>

              {state && "error" in state && <FieldError>{state.error}</FieldError>}
            </form>
          </div>
        </div>
      )}

      {noProjects && (
        <span className="ml-3 text-xs text-fg-subtle">
          Creá un proyecto primero
        </span>
      )}
    </>
  );
}
