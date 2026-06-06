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
  currentProjectId: string | null;
}

/**
 * Per-row "Editar" trigger + edit modal. Form fields: full_name, plus a
 * project selector for non-superadmin users (superadmins don't belong to
 * project_members per spec). Role is read-only here.
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

  const showProjectSelector = user.role !== "superadmin";

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
                  <Label htmlFor="edit-project_id">Proyecto</Label>
                  <Select
                    id="edit-project_id"
                    name="project_id"
                    required
                    defaultValue={user.currentProjectId ?? ""}
                  >
                    <option value="" disabled>
                      Elegí uno…
                    </option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                  <p className="mt-1 text-xs text-fg-subtle">
                    Reemplaza la asignación anterior por la elegida.
                  </p>
                </div>
              )}

              <div>
                <Label>Rol</Label>
                <div className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg-muted">
                  {user.role}{" "}
                  <span className="ml-2 text-xs text-fg-subtle">
                    (no editable desde la UI)
                  </span>
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
