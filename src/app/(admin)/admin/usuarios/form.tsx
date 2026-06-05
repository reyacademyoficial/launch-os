"use client";

import { useActionState } from "react";

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

export function CreateUserForm({
  projects,
}: {
  readonly projects: readonly Project[];
}) {
  const [state, formAction, pending] = useActionState<CreateUserState, FormData>(
    createUser,
    null,
  );

  return (
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
            <option value="cliente">cliente (solo lectura)</option>
            <option value="admin">admin (lectura + escritura)</option>
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
      <Button type="submit" disabled={pending || projects.length === 0}>
        {pending ? "Creando…" : "Crear usuario"}
      </Button>

      {state && "error" in state && <FieldError>{state.error}</FieldError>}
      {state && "ok" in state && state.ok && (
        <p role="status" className="rounded-md border border-success/40 bg-success/10 p-3 text-sm text-success">
          Usuario <strong>{state.email}</strong> creado como{" "}
          <strong>{state.role}</strong> y asignado al proyecto. Compartile las
          credenciales por un canal seguro.
        </p>
      )}
      {projects.length === 0 && (
        <p className="text-xs text-fg-subtle">
          No hay proyectos cargados todavía. Creá uno desde Studio (o, cuando exista,
          desde <code>/proyectos</code>) antes de crear usuarios.
        </p>
      )}
    </form>
  );
}
