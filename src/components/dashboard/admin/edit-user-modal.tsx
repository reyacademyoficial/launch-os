"use client";

import { useActionState, useEffect, useState } from "react";

import type { UpdateUserState } from "@/app/(admin)/admin/usuarios/actions";
import { updateUser } from "@/app/(admin)/admin/usuarios/actions";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { Role } from "@/lib/supabase/auth";

interface Project {
  id: string;
  name: string;
}

interface EditableUser {
  id: string;
  email: string;
  fullName: string | null;
  role: Role;
  currentProjectIds: readonly string[];
}

/**
 * Per-row "Editar" trigger + edit modal. Form fields: full_name, role, y un
 * project selector para roles distintos de superadmin (los superadmin no
 * cargan project_members por spec). El rol de superadmin queda read-only para
 * evitar demote accidental desde la UI — si hace falta, se hace por Studio.
 */
export function EditUserModal({
  user,
  projects,
}: {
  readonly user: EditableUser;
  readonly projects: readonly Project[];
}) {
  const [open, setOpen] = useState(false);
  const boundAction = updateUser.bind(null, user.id);
  const [state, formAction, pending] = useActionState<UpdateUserState, FormData>(
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

  const isSuperadmin = user.role === "superadmin";
  const showProjectSelector = !isSuperadmin;

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
          aria-labelledby="edit-user-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="w-full max-w-lg rounded-md border border-border bg-bg-elevated p-6 shadow-card">
            <header className="mb-4 flex items-start justify-between">
              <div>
                <h3 id="edit-user-title" className="text-lg font-bold text-fg">
                  Editar usuario
                </h3>
                <p className="mt-1 text-xs text-fg-muted">{user.email}</p>
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
                  autoComplete="off"
                  defaultValue={user.fullName ?? ""}
                  placeholder="Opcional"
                />
              </div>

              {showProjectSelector && (
                <div>
                  <Label>Proyectos</Label>
                  {projects.length === 0 ? (
                    <p className="text-xs text-fg-subtle">
                      No hay proyectos creados todavía.
                    </p>
                  ) : (
                    <div className="space-y-2 rounded-md border border-border bg-surface p-3 max-h-48 overflow-y-auto">
                      {projects.map((p) => (
                        <label
                          key={p.id}
                          className="flex cursor-pointer items-center gap-2 text-sm text-fg"
                        >
                          <input
                            type="checkbox"
                            name="project_ids"
                            value={p.id}
                            defaultChecked={user.currentProjectIds.includes(p.id)}
                            className="accent-accent"
                          />
                          <span>{p.name}</span>
                        </label>
                      ))}
                    </div>
                  )}
                  <p className="mt-1 text-xs text-fg-subtle">
                    El usuario tendrá acceso a los proyectos que tildés.
                  </p>
                </div>
              )}

              <div>
                <Label htmlFor="edit-role">Rol</Label>
                {isSuperadmin ? (
                  <div className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg-muted">
                    superadmin{" "}
                    <span className="ml-2 text-xs text-fg-subtle">
                      (no editable desde la UI)
                    </span>
                  </div>
                ) : (
                  <Select
                    id="edit-role"
                    name="role"
                    required
                    defaultValue={user.role}
                  >
                    <option value="cliente">cliente (solo lectura, scope por launch)</option>
                    <option value="operador">operador (edita launches asignados)</option>
                    <option value="coordinador">coordinador (clientes + academia + ops propias)</option>
                    <option value="admin">admin (lectura + escritura del proyecto)</option>
                  </Select>
                )}
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
